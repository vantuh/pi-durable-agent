/** One conversation: its event stream, what is said to it, stopping it, its model, its skills, and its commands. */

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import type { Conversation, Harness, SubmissionId } from "@earendil-works/pi-durable";
import { type Context, Hono } from "hono";

import { recordOf } from "../../shared/guards.ts";
import { runCommand } from "../commands.ts";
import { entryAt, historyPage } from "../history.ts";
import {
    answer,
    type ApiEnv,
    readJson,
    RESPONSE_ALREADY_SENT,
    sessionIdOf,
    string,
} from "../http.ts";
import { projectFiles } from "../project-files.ts";
import { toolImageOf } from "../projection.ts";
import type { Opened, Sessions } from "../sessions.ts";
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
    stream: (request: IncomingMessage, response: ServerResponse, opened: Opened) => Promise<void>;
}) {
    const { sessions, attach } = deps;

    /** The session a request names, the root one when it names none, `undefined` when the id is not valid. */
    function sessionFrom(value: unknown): number | undefined {
        return value === undefined || value === null ? deps.rootId() : sessionIdOf(value);
    }

    /** The browser asks before it knows its session (`?session=NaN`): an invalid query id means the root one. */
    function querySession(c: Context<ApiEnv>): number {
        return sessionIdOf(Number(c.req.query("session"))) ?? deps.rootId();
    }

    function badSession(c: Context<ApiEnv>) {
        return c.json({ error: "session must be a positive integer" }, 400);
    }

    return new Hono<ApiEnv>()
        .get("/api/events", async (c) => {
            const opened = await attach(querySession(c));

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            await deps.stream(c.env.incoming, c.env.outgoing, opened);

            return RESPONSE_ALREADY_SENT;
        })
        .get("/api/history", async (c) => {
            const id = querySession(c);
            const raw = c.req.query("before");
            const before = raw === undefined ? undefined : sessionIdOf(Number(raw));

            if (raw !== undefined && before === undefined) {
                return c.json({ error: "before must be a positive entry id" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            // A page carries whole entries, so it can be big: answered by hand for its gzip.
            answer(
                c.env.outgoing,
                200,
                await historyPage({
                    conversation: opened.conversation,
                    context,
                    ...(before === undefined ? {} : { before }),
                }),
                c.env.incoming,
            );

            return RESPONSE_ALREADY_SENT;
        })
        .get("/api/entry-image", async (c) => {
            const id = sessionIdOf(Number(c.req.query("session")));
            const entry = sessionIdOf(Number(c.req.query("entry")));
            // A missing index means the first picture.
            const index = Number(c.req.query("index") ?? 0);

            if (
                id === undefined ||
                entry === undefined ||
                !Number.isSafeInteger(index) ||
                index < 0
            ) {
                return c.json({ error: "session, entry and index are required" }, 400);
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
                return c.json({ error: "no such image" }, 404);
            }

            c.env.outgoing.writeHead(200, {
                "content-type": image.mimeType,
                "x-content-type-options": "nosniff",
                "cache-control": "private, max-age=3600",
            });
            c.env.outgoing.end(image.bytes);

            return RESPONSE_ALREADY_SENT;
        })
        .post("/api/messages", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const text = string(payload?.["text"]) ?? "";
            const id = sessionFrom(payload?.["session"]);

            if (id === undefined) {
                return badSession(c);
            }

            const opened = await attach(id);
            const files = Array.isArray(payload?.["files"])
                ? payload["files"].filter((file): file is string => typeof file === "string")
                : [];

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            if (text.trim() === "" && files.length === 0) {
                return c.json({ error: "text is required" }, 400);
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
            // A run that starts touches it too, but a steer or a follow-up joins a run already going,
            // and the person's write is what moves the row.
            await sessions.touch(opened.id);

            return c.json({ ok: true }, 202);
        })
        .post("/api/queued/withdraw", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const id = sessionFrom(payload?.["session"]);
            const item = sessionIdOf(payload?.["id"]);

            if (id === undefined) {
                return badSession(c);
            }

            if (item === undefined) {
                return c.json({ error: "id must be a positive integer" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            // A submission id is a number at run time; the brand lives only in the type.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value passed a positive-integer check
            const submission = item as SubmissionId;
            const result = await deps.harness.abortSubmission(submission, context, opened.id);

            return c.json({ result }, 200);
        })
        .post("/api/abort", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const id = sessionFrom(payload?.["session"]);

            if (id === undefined) {
                return badSession(c);
            }

            const opened = await attach(id);

            if (opened !== undefined) {
                await opened.conversation.abort(context);
            }

            return c.json({ ok: true }, 202);
        })
        .post("/api/agent", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const id = sessionFrom(payload?.["session"]);

            if (id === undefined) {
                return badSession(c);
            }

            const opened = await attach(id);
            const model = recordOf(payload?.["model"]);
            const provider = string(model?.["provider"]);
            const modelId = string(model?.["modelId"]);
            const level = string(payload?.["thinkingLevel"]);
            const thinkingLevel = MODEL_THINKING_LEVELS.find((known) => known === level);

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
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

            return c.json({ ok: true }, 202);
        })
        .post("/api/commands", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const name = string(payload?.["name"]) ?? "";
            const args = string(payload?.["args"]) ?? "";
            const id = sessionFrom(payload?.["session"]);

            if (id === undefined) {
                return badSession(c);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            try {
                return c.json(
                    await runCommand(name, {
                        conversation: opened.conversation,
                        harness: deps.harness,
                        context,
                        args,
                    }),
                    200,
                );
            } catch (error) {
                return c.json(
                    {
                        error: error instanceof Error ? error.message : "the command failed",
                    },
                    400,
                );
            }
        })
        .get("/api/skills", async (c) => {
            const opened = await attach(querySession(c));
            const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

            return c.json({
                skills: skillsFor(cwd).map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                })),
            });
        })
        .get("/api/project-files", async (c) => {
            const opened = await attach(querySession(c));
            const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

            return c.json({ files: await projectFiles(cwd) });
        });
}
