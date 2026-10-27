/** The session list: rows, a new session, archiving, deleting and renaming. */

import { answer, readJson, record, type Route, sessionIdOf, string } from "../http.ts";
import type { Opened, Sessions } from "../sessions.ts";

export function sessionRoutes(deps: {
    sessions: Sessions;
    attach: (id: number) => Promise<Opened | undefined>;
    busy: (id: number) => boolean;
    endedAt: (id: number) => number | undefined;
    /** Drops a deleted session from the streams and the maps the server keeps for it. */
    forget: (id: number) => void;
}): Route[] {
    const { sessions, attach } = deps;

    return [
        {
            method: "GET",
            path: /^\/api\/sessions$/,
            handle: async (_request, response) => {
                answer(response, 200, { sessions: await sessions.list(deps.busy, deps.endedAt) });
            },
        },
        {
            method: "POST",
            path: /^\/api\/sessions$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const cwd = string(payload?.["cwd"]);
                const conversation = await sessions.create(cwd ?? process.cwd());

                await attach(Number(conversation.id));
                answer(response, 201, { session: Number(conversation.id) });
            },
        },
        {
            method: "POST",
            path: /^\/api\/sessions\/archive$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionIdOf(payload?.["session"]);
                const archived = payload?.["archived"];

                if (id === undefined || typeof archived !== "boolean") {
                    answer(response, 400, { error: "Expected a session id and archived boolean" });
                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "Session not found" });
                    return;
                }

                await sessions.setArchived(opened.id, archived);
                answer(response, 200, { ok: true });
            },
        },
        {
            method: "POST",
            path: /^\/api\/sessions\/delete$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionIdOf(payload?.["session"]);

                if (id === undefined) {
                    answer(response, 400, { error: "Expected a session id" });
                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "Session not found" });
                    return;
                }

                await sessions.delete(opened.id);
                deps.forget(id);
                answer(response, 200, { ok: true });
            },
        },
        {
            method: "POST",
            path: /^\/api\/sessions\/title$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const id = sessionIdOf(payload?.["session"]);
                const title = payload?.["title"];

                if (id === undefined || typeof title !== "string") {
                    answer(response, 400, { error: "Expected a session id and a title string" });
                    return;
                }

                const opened = await attach(id);

                if (opened === undefined) {
                    answer(response, 404, { error: "Session not found" });
                    return;
                }

                await sessions.setTitle(opened.id, title.trim().slice(0, 80));
                answer(response, 200, { ok: true });
            },
        },
    ];
}
