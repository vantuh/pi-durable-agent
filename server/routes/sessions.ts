/** The session list: rows, a new session, archiving, deleting, renaming and marking seen. */

import type { IncomingMessage, ServerResponse } from "node:http";

import { Hono } from "hono";

import { recordOf } from "../../shared/guards.ts";
import type { SessionSummary } from "../../shared/protocol.ts";
import {
    answer,
    type ApiEnv,
    readJson,
    RESPONSE_ALREADY_SENT,
    sessionIdOf,
    string,
} from "../http.ts";
import type { Opened, Sessions } from "../sessions.ts";

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
        .post("/api/sessions", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const cwd = string(payload?.["cwd"]);
            const conversation = await sessions.create(cwd ?? process.cwd());

            await attach(Number(conversation.id));

            return c.json({ session: Number(conversation.id) }, 201);
        })
        .post("/api/sessions/archive", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));
            const id = sessionIdOf(payload?.["session"]);

            c.set("changedSession", id);

            const archived = payload?.["archived"];

            if (id === undefined || typeof archived !== "boolean") {
                return c.json({ error: "Expected a session id and archived boolean" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.setArchived(opened.id, archived);

            return c.json({ ok: true }, 200);
        })
        .post("/api/sessions/delete", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));
            const id = sessionIdOf(payload?.["session"]);

            c.set("changedSession", id);

            if (id === undefined) {
                return c.json({ error: "Expected a session id" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.delete(opened.id);
            detach(opened.id);

            return c.json({ ok: true }, 200);
        })
        .post("/api/sessions/title", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));
            const id = sessionIdOf(payload?.["session"]);

            c.set("changedSession", id);

            const title = payload?.["title"];

            if (id === undefined || typeof title !== "string") {
                return c.json({ error: "Expected a session id and a title string" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.setTitle(opened.id, title.trim().slice(0, 80));

            return c.json({ ok: true }, 200);
        })
        .post("/api/sessions/seen", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));
            const id = sessionIdOf(payload?.["session"]);

            c.set("changedSession", id);

            if (id === undefined) {
                return c.json({ error: "Expected a session id" }, 400);
            }

            const opened = await attach(id);

            if (opened === undefined) {
                return c.json({ error: "Session not found" }, 404);
            }

            await sessions.seen(opened.id);

            return c.json({ ok: true }, 200);
        });
}
