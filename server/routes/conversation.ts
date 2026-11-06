/** One conversation: its event stream, what is said to it, stopping it, its model, its skills, and its commands. */

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import type { Conversation, Harness, SubmissionId } from "@earendil-works/pi-durable";
import { Hono } from "hono";
import { z } from "zod";

import { runCommand } from "../commands.ts";
import { entryAt, historyPage } from "../history.ts";
import { answer, type ApiEnv, RESPONSE_ALREADY_SENT } from "../http.ts";
import { projectFiles } from "../project-files.ts";
import { toolImageOf } from "../projection.ts";
import type { Opened, Sessions } from "../sessions.ts";
import { expandSkillCommand, skillsFor } from "../skills.ts";
import { jsonBody, lenient, PositiveId, queryOf, QueryNumber, StringList } from "../validate.ts";
import { IMAGE_TYPES } from "./files.ts";

/** A session a body names: none means the root one, and anything else must be an id. */
const BodySession = PositiveId.nullish();
/**
 * The browser asks before it knows its session (`?session=NaN`): a query session that is no id means the root
 * one.
 */
const QuerySession = lenient(QueryNumber.pipe(PositiveId));
const BAD_SESSION = "session must be a positive integer";

const ModelBody = z.object({ provider: z.string(), modelId: z.string() });

const MessageBody = z.object({
    session: BodySession,
    text: z.string().default("").catch(""),
    files: StringList,
    mode: lenient(z.enum(["interrupt", "steer", "followUp"])),
});
const WithdrawBody = z.object({ session: BodySession, id: PositiveId });
const AbortBody = z.object({ session: BodySession });
const AgentBody = z.object({
    session: BodySession,
    model: lenient(ModelBody),
    thinkingLevel: lenient(z.enum(MODEL_THINKING_LEVELS)),
});
const CommandBody = z.object({
    session: BodySession,
    name: z.string().default("").catch(""),
    args: z.string().default("").catch(""),
});

const SessionQuery = z.object({ session: QuerySession });
const HistoryQuery = z.object({
    session: QuerySession,
    before: QueryNumber.pipe(PositiveId).optional(),
});
/** A missing index means the first picture. */
const EntryImageQuery = z.object({
    session: QueryNumber.pipe(PositiveId),
    entry: QueryNumber.pipe(PositiveId),
    index: QueryNumber.pipe(z.int().nonnegative()).default(0),
});

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

    return new Hono<ApiEnv>()
        .get("/api/events", queryOf(SessionQuery), async (c) => {
            const opened = await attach(c.req.valid("query").session ?? deps.rootId());

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            await deps.stream(c.env.incoming, c.env.outgoing, opened);

            return RESPONSE_ALREADY_SENT;
        })
        .get(
            "/api/history",
            queryOf(HistoryQuery, "before must be a positive entry id"),
            async (c) => {
                const { session, before } = c.req.valid("query");
                const opened = await attach(session ?? deps.rootId());

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
            },
        )
        .get(
            "/api/entry-image",
            queryOf(EntryImageQuery, "session, entry and index are required"),
            async (c) => {
                const { session, entry, index } = c.req.valid("query");
                const opened = await attach(session);
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
            },
        )
        .post("/api/messages", jsonBody(MessageBody, BAD_SESSION), async (c) => {
            const { session, text, files, mode } = c.req.valid("json");
            const opened = await attach(session ?? deps.rootId());

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            if (text.trim() === "" && files.length === 0) {
                return c.json({ error: "text is required" }, 400);
            }

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
        .post(
            "/api/queued/withdraw",
            jsonBody(WithdrawBody, (path) =>
                path[0] === "id" ? "id must be a positive integer" : BAD_SESSION,
            ),
            async (c) => {
                const { session, id } = c.req.valid("json");
                const opened = await attach(session ?? deps.rootId());

                if (opened === undefined) {
                    return c.json({ error: "no such session" }, 404);
                }

                // A submission id is a number at run time; the brand lives only in the type.
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value passed a positive-integer check
                const submission = id as SubmissionId;
                const result = await deps.harness.abortSubmission(submission, context, opened.id);

                return c.json({ result }, 200);
            },
        )
        .post("/api/abort", jsonBody(AbortBody, BAD_SESSION), async (c) => {
            const opened = await attach(c.req.valid("json").session ?? deps.rootId());

            if (opened !== undefined) {
                await opened.conversation.abort(context);
            }

            return c.json({ ok: true }, 202);
        })
        .post("/api/agent", jsonBody(AgentBody, BAD_SESSION), async (c) => {
            const { session, model, thinkingLevel } = c.req.valid("json");
            const opened = await attach(session ?? deps.rootId());

            if (opened === undefined) {
                return c.json({ error: "no such session" }, 404);
            }

            await opened.conversation.configure(
                {
                    ...(model === undefined ? {} : { model }),
                    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
                },
                context,
            );

            return c.json({ ok: true }, 202);
        })
        .post("/api/commands", jsonBody(CommandBody, BAD_SESSION), async (c) => {
            const { session, name, args } = c.req.valid("json");
            const opened = await attach(session ?? deps.rootId());

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
        .get("/api/skills", queryOf(SessionQuery), async (c) => {
            const opened = await attach(c.req.valid("query").session ?? deps.rootId());
            const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

            return c.json({
                skills: skillsFor(cwd).map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                })),
            });
        })
        .get("/api/project-files", queryOf(SessionQuery), async (c) => {
            const opened = await attach(c.req.valid("query").session ?? deps.rootId());
            const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

            return c.json({ files: await projectFiles(cwd) });
        });
}
