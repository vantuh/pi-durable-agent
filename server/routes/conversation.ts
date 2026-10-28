/** One conversation: its event stream, what is said to it, stopping it, its model, its skills, and its commands. */

import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { basename, extname } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Conversation, Harness, SubmissionId } from "@earendil-works/pi-durable";

import { runCommand } from "../commands.ts";
import { entryAt, historyPage } from "../history.ts";
import { answer, readJson, record, type Route, sessionIdOf, string } from "../http.ts";
import { toolImageOf } from "../projection.ts";
import { type Opened, type Sessions, THINKING_LEVELS } from "../sessions.ts";
import { expandSkillCommand, skillsFor } from "../skills.ts";
import { IMAGE_TYPES } from "./files.ts";

type Content = Extract<Parameters<Conversation["submit"]>[0], { type: "input" }>["content"];

async function contentOf(files: readonly string[], text: string): Promise<Content> {
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    const mentioned: string[] = [];

    for (const file of files) {
        const mime = IMAGE_TYPES[extname(file).toLowerCase()];

        if (mime === undefined) {
            mentioned.push(file);

            continue;
        }

        images.push({
            type: "image",
            data: (await readFile(file)).toString("base64"),
            mimeType: mime,
        });
    }

    const said = mentioned.reduce((whole, file) => `${whole}\n\nAttached file: ${file}`, text);

    return [{ type: "text", text: said }, ...images];
}

export function conversationRoutes(deps: {
    sessions: Sessions;
    attach: (id: number) => Promise<Opened | undefined>;
    rootId: () => number;
    /** Withdraws one queued input, which deletes its `pi.inbox` item in the harness's own commit. */
    harness: Harness;
    /** Starts the event stream of an opened session on this response. */
    stream: (response: ServerResponse, opened: Opened) => Promise<void>;
}): Route[] {
    const { sessions, attach } = deps;

    /** The session a request names, the root one when it names none, `undefined` when the id is not valid. */
    function sessionFrom(value: unknown): number | undefined {
        return value === undefined || value === null ? deps.rootId() : sessionIdOf(value);
    }

    /** The browser asks before it knows its session (`?session=NaN`): an invalid query id means the root one. */
    function querySession(url: URL): number {
        return sessionIdOf(Number(url.searchParams.get("session"))) ?? deps.rootId();
    }

    function badSession(response: ServerResponse): void {
        answer(response, 400, { error: "session must be a positive integer" });
    }

    return [
        {
            method: "GET",
            path: /^\/api\/events$/,
            handle: async (_request, response, url) => {
                const id = querySession(url);

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                await deps.stream(response, opened);
            },
        },
        {
            method: "GET",
            path: /^\/api\/history$/,
            handle: async (_request, response, url) => {
                const id = querySession(url);
                const raw = url.searchParams.get("before");
                const before = raw === null ? undefined : sessionIdOf(Number(raw));

                if (raw !== null && before === undefined) {
                    answer(response, 400, { error: "before must be a positive entry id" });

                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                answer(
                    response,
                    200,
                    await historyPage({
                        conversation: opened.conversation,
                        context,
                        ...(before === undefined ? {} : { before }),
                    }),
                );
            },
        },
        {
            method: "GET",
            path: /^\/api\/entry-image$/,
            handle: async (_request, response, url) => {
                const id = sessionIdOf(Number(url.searchParams.get("session")));
                const entry = sessionIdOf(Number(url.searchParams.get("entry")));
                const index = Number(url.searchParams.get("index"));

                if (
                    id === undefined ||
                    entry === undefined ||
                    !Number.isSafeInteger(index) ||
                    index < 0
                ) {
                    answer(response, 400, { error: "session, entry and index are required" });

                    return;
                }

                const opened = await attach(id);
                const stored =
                    opened === undefined
                        ? undefined
                        : await entryAt({
                              conversation: opened.conversation,
                              context,
                              id: entry,
                          });
                const image = stored === undefined ? undefined : toolImageOf(stored, index);

                if (image === undefined) {
                    answer(response, 404, { error: "no such image" });

                    return;
                }

                response.writeHead(200, {
                    "content-type": image.mimeType,
                    "x-content-type-options": "nosniff",
                    "cache-control": "private, max-age=3600",
                });
                response.end(image.bytes);
            },
        },
        {
            method: "POST",
            path: /^\/api\/messages$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const text = string(payload?.["text"]) ?? "";
                const id = sessionFrom(payload?.["session"]);

                if (id === undefined) {
                    badSession(response);

                    return;
                }

                const opened = await attach(id);
                const files = Array.isArray(payload?.["files"])
                    ? payload["files"].filter((file): file is string => typeof file === "string")
                    : [];

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                if (text.trim() === "" && files.length === 0) {
                    answer(response, 400, { error: "text is required" });

                    return;
                }

                const mode = string(payload?.["mode"]);
                // `/skill:name request` carries the skill's instructions; the screen keeps showing what was typed.
                const cwd = (await opened.conversation.agent(context))?.cwd ?? process.cwd();
                const expanded = text.startsWith("/skill:")
                    ? expandSkillCommand(text, skillsFor(cwd))
                    : text;

                if (mode === "interrupt") {
                    await opened.conversation.abort(context);
                }

                await opened.conversation.submit(
                    {
                        type: "input",
                        content: await contentOf(files, expanded),
                        ...(files.length === 0 && expanded === text
                            ? {}
                            : {
                                  entry: {
                                      kind: "chat.user",
                                      data: {
                                          text,
                                          files: await Promise.all(
                                              files.map(async (path) => ({
                                                  path,
                                                  name: basename(path).replace(/^\d+-/, ""),
                                                  size: (await stat(path)).size,
                                                  image:
                                                      IMAGE_TYPES[extname(path).toLowerCase()] !==
                                                      undefined,
                                              })),
                                          ),
                                      },
                                  },
                              }),
                        ...(mode === "steer" || mode === "followUp" ? { whenBusy: mode } : {}),
                    },
                    context,
                );
                await sessions.touch(opened.id);
                answer(response, 202, { ok: true });
            },
        },
        {
            method: "POST",
            path: /^\/api\/queued\/withdraw$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionFrom(payload?.["session"]);
                const item = sessionIdOf(payload?.["id"]);

                if (id === undefined) {
                    badSession(response);

                    return;
                }

                if (item === undefined) {
                    answer(response, 400, { error: "id must be a positive integer" });

                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                // A submission id is a number at run time; the brand lives only in the type.
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value passed a positive-integer check
                const submission = item as SubmissionId;
                const result = await deps.harness.abortSubmission(submission, context, opened.id);

                answer(response, 200, { result });
            },
        },
        {
            method: "POST",
            path: /^\/api\/abort$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionFrom(payload?.["session"]);

                if (id === undefined) {
                    badSession(response);

                    return;
                }

                const opened = await attach(id);

                if (opened !== undefined) {
                    await opened.conversation.abort(context);
                }

                answer(response, 202, { ok: true });
            },
        },
        {
            method: "POST",
            path: /^\/api\/agent$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionFrom(payload?.["session"]);

                if (id === undefined) {
                    badSession(response);

                    return;
                }

                const opened = await attach(id);
                const model = record(payload?.["model"]);
                const provider = string(model?.["provider"]);
                const modelId = string(model?.["modelId"]);
                const level = string(payload?.["thinkingLevel"]);
                const thinkingLevel = THINKING_LEVELS.find((known) => known === level);

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                await opened.conversation.configure(
                    {
                        ...(provider === undefined || modelId === undefined
                            ? {}
                            : { model: { provider, modelId } }),
                        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
                    },
                    context,
                );
                answer(response, 202, { ok: true });
            },
        },
        {
            method: "POST",
            path: /^\/api\/commands$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const name = string(payload?.["name"]) ?? "";
                const args = string(payload?.["args"]) ?? "";
                const id = sessionFrom(payload?.["session"]);

                if (id === undefined) {
                    badSession(response);

                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "no such session" });

                    return;
                }

                try {
                    answer(
                        response,
                        200,
                        await runCommand(name, {
                            conversation: opened.conversation,
                            harness: deps.harness,
                            context,
                            args,
                        }),
                    );
                } catch (error) {
                    answer(response, 400, {
                        error: error instanceof Error ? error.message : "the command failed",
                    });
                }
            },
        },
        {
            method: "GET",
            path: /^\/api\/skills$/,
            handle: async (_request, response, url) => {
                const id = querySession(url);

                const opened = await attach(id);
                const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

                answer(response, 200, {
                    skills: skillsFor(cwd).map((skill) => ({
                        name: skill.name,
                        description: skill.description,
                    })),
                });
            },
        },
    ];
}
