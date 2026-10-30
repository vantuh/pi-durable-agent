/** The session list: rows, a new session, archiving, deleting, renaming and marking seen. */

import type { ServerResponse } from "node:http";

import type { SessionSummary } from "../../shared/protocol.ts";
import { answer, readJson, record, type Route, sessionIdOf, string } from "../http.ts";
import type { Opened, Sessions } from "../sessions.ts";

export function sessionRoutes(deps: {
    sessions: Sessions;
    attach: (id: number) => Promise<Opened | undefined>;
    /** Forgets everything the server still holds for a session that is now deleted. */
    detach: (id: number) => void;
    /** The session rows as the browser reads them: their marks come from extensions. */
    list: () => Promise<SessionSummary[]>;
    watch: (response: ServerResponse) => Promise<void>;
}): Route[] {
    const { sessions, attach, detach } = deps;

    return [
        {
            method: "GET",
            path: /^\/api\/sessions$/,
            handle: async (_request, response) => {
                answer(response, 200, { sessions: await deps.list() });
            },
        },
        {
            method: "GET",
            path: /^\/api\/sessions\/events$/,
            handle: async (_request, response) => {
                await deps.watch(response);
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
                detach(opened.id);
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
        {
            method: "POST",
            path: /^\/api\/sessions\/seen$/,
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

                await sessions.seen(opened.id);
                answer(response, 200, { ok: true });
            },
        },
    ];
}
