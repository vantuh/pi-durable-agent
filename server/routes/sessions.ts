/** The session list: rows, a new session, archiving, deleting, renaming and marking seen. */

import type { IncomingMessage, ServerResponse } from "node:http";

import { Hono } from "hono";
import { z } from "zod";

import type { SessionSummary } from "../../shared/protocol.ts";
import { answer, type ApiEnv, RESPONSE_ALREADY_SENT } from "../http.ts";
import type { Opened, Sessions } from "../sessions.ts";
import { jsonBody, lenient, PositiveId } from "../validate.ts";

const CreateBody = z.object({ cwd: lenient(z.string()) });
const ArchiveBody = z.object({ session: PositiveId, archived: z.boolean() });
const SessionBody = z.object({ session: PositiveId });
const TitleBody = z.object({ session: PositiveId, title: z.string() });

export function sessionRoutes(deps: {
    sessions: Sessions;
    attach: (id: number) => Promise<Opened | undefined>;
    /** Forgets everything the server still holds for a session that is now deleted. */
    detach: (id: number) => void;
    /** The session rows as the browser reads them: their marks come from extensions. */
    list: () => Promise<SessionSummary[]>;
    watch: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
}) {
    const { sessions, attach, detach } = deps;

    return new Hono<ApiEnv>()
        .get("/api/sessions", async (c) => {
            // Every row the browser shows, which is big enough to gain from a gzip: answered by hand.
            answer(c.env.outgoing, 200, { sessions: await deps.list() }, c.env.incoming);

            return RESPONSE_ALREADY_SENT;
        })
        .get("/api/sessions/events", async (c) => {
            await deps.watch(c.env.incoming, c.env.outgoing);

            return RESPONSE_ALREADY_SENT;
        })
        .post("/api/sessions", jsonBody(CreateBody), async (c) => {
            const { cwd } = c.req.valid("json");
            const conversation = await sessions.create(cwd ?? process.cwd());

            await attach(Number(conversation.id));

            return c.json({ session: Number(conversation.id) }, 201);
        })
        .post(
            "/api/sessions/archive",
            jsonBody(ArchiveBody, "Expected a session id and archived boolean"),
            async (c) => {
                const { session, archived } = c.req.valid("json");
                const opened = await attach(session);

                if (opened === undefined) {
                    return c.json({ error: "Session not found" }, 404);
                }

                await sessions.setArchived(opened.id, archived);

                return c.json({ ok: true }, 200);
            },
        )
        .post("/api/sessions/delete", jsonBody(SessionBody, "Expected a session id"), async (c) => {
            const opened = await attach(c.req.valid("json").session);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.delete(opened.id);
            detach(opened.id);

            return c.json({ ok: true }, 200);
        })
        .post(
            "/api/sessions/title",
            jsonBody(TitleBody, "Expected a session id and a title string"),
            async (c) => {
                const { session, title } = c.req.valid("json");
                const opened = await attach(session);

                if (opened === undefined) {
                    return c.json({ error: "Session not found" }, 404);
                }

                await sessions.setTitle(opened.id, title.trim().slice(0, 80));

                return c.json({ ok: true }, 200);
            },
        )
        .post("/api/sessions/seen", jsonBody(SessionBody, "Expected a session id"), async (c) => {
            const opened = await attach(c.req.valid("json").session);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.seen(opened.id);

            return c.json({ ok: true }, 200);
        });
}
