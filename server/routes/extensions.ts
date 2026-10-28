/** The extension list and switches, and each extension's actions and raw HTTP. */

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import {
    ActionError,
    ActionNotFound,
    type Extensions,
    parseActionBody,
    type SessionRef,
} from "../extensions.ts";
import { answer, answerError, readJson, type Route } from "../http.ts";
import type { Opened } from "../sessions.ts";

function badBody(error: unknown): never {
    throw new ActionError(error instanceof Error ? error.message : "the body is not valid");
}

export function extensionRoutes(deps: {
    extensions: Extensions;
    attach: (id: number) => Promise<Opened | undefined>;
    ownerOf: (id: number) => Promise<number | undefined>;
}): Route[] {
    const { extensions, attach, ownerOf } = deps;

    return [
        {
            method: "*",
            path: /^\/api\/extensions\/([^/]+)\/http(\/.*)$/,
            handle: async (request, response, url, match) => {
                try {
                    await extensions.serveHttp(decodeURIComponent(match[1] ?? ""), {
                        request,
                        response,
                        path: (match[2] ?? "/") + url.search,
                    });
                } catch (error) {
                    if (response.headersSent) {
                        response.destroy();
                    } else {
                        answer(response, error instanceof ActionNotFound ? 404 : 500, {
                            error: error instanceof Error ? error.message : "extension HTTP failed",
                        });
                    }
                }
            },
        },
        {
            // 400 for bad input, 404 for an unknown extension, action or session, 500 for any other failure.
            method: "POST",
            path: /^\/api\/extensions\/([^/]+)\/actions\/([^/]+)$/,
            handle: async (request, response, _url, match) => {
                try {
                    const parsed = parseActionBody(await readJson(request).catch(badBody));
                    let session: SessionRef | null = null;

                    if (parsed.session !== undefined) {
                        const opened = await attach(parsed.session);

                        if (opened === undefined) {
                            answer(response, 404, { error: "no such session" });

                            return;
                        }

                        const agent = await opened.conversation.agent(context);

                        const owner = await ownerOf(parsed.session);

                        session = {
                            id: parsed.session,
                            cwd: agent.cwd ?? null,
                            ...(owner === undefined ? {} : { owner }),
                        };
                    }

                    const result = await extensions.call(
                        decodeURIComponent(match[1] ?? ""),
                        decodeURIComponent(match[2] ?? ""),
                        { args: parsed.args, session },
                    );

                    answer(response, 200, { result });
                } catch (error) {
                    answerError(response, error, "the action failed");
                }
            },
        },
        {
            method: "GET",
            path: /^\/api\/extensions$/,
            handle: (_request, response) => {
                answer(response, 200, {
                    installed: extensions.names,
                    failed: extensions.failed,
                    extensions: extensions.list,
                });
            },
        },
        {
            // 400 for a body that is not `{ enabled: boolean }`, 404 for an unknown folder.
            method: "PUT",
            path: /^\/api\/extensions\/([^/]+)$/,
            handle: async (request, response, _url, match) => {
                try {
                    const parsed: unknown = await readJson(request).catch(badBody);
                    const enabled: unknown =
                        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
                            ? Reflect.get(parsed, "enabled")
                            : undefined;

                    if (typeof enabled !== "boolean") {
                        throw new ActionError("the body must be { enabled: boolean }");
                    }

                    answer(
                        response,
                        200,
                        await extensions.setEnabled(decodeURIComponent(match[1] ?? ""), enabled),
                    );
                } catch (error) {
                    answerError(response, error, "the change failed");
                }
            },
        },
    ];
}
