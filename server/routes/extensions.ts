/** The extension list and switches, and each extension's actions and raw HTTP. */

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Hono } from "hono";

import {
    ActionError,
    ActionNotFound,
    type Extensions,
    parseActionBody,
    type SessionRef,
} from "../extensions.ts";
import { answer, answerError, type ApiEnv, readJson, RESPONSE_ALREADY_SENT } from "../http.ts";
import type { Opened } from "../sessions.ts";

/**
 * An extension's URL, matched against the path as it was sent: `c.req.path` is decoded, and an extension has
 * always been handed its own path still encoded, to decode as it knows how.
 */
const EXTENSION_HTTP = /^\/api\/extensions\/([^/]+)\/http(\/.*)$/;
const EXTENSION_ACTION = /^\/api\/extensions\/([^/]+)\/actions\/([^/]+)$/;
const EXTENSION_TOGGLE = /^\/api\/extensions\/([^/]+)$/;

/** The segment at `index` of a path that matched `pattern`, decoded strictly: an escape that cannot be is bad input. */
function segmentOf(pattern: RegExp, pathname: string, index: number): string {
    const match = pattern.exec(pathname);

    if (match === null) {
        throw new ActionNotFound("not found");
    }

    return decodeURIComponent(match[index] ?? "");
}

function badBody(error: unknown): never {
    throw new ActionError(error instanceof Error ? error.message : "the body is not valid");
}

export function extensionRoutes(deps: {
    extensions: Extensions;
    attach: (id: number) => Promise<Opened | undefined>;
    ownerOf: (id: number) => Promise<number | undefined>;
}) {
    const { extensions, attach, ownerOf } = deps;

    return new Hono<ApiEnv>()
        .all("/api/extensions/:name/http/*", async (c) => {
            const url = new URL(c.req.url);
            const match = EXTENSION_HTTP.exec(url.pathname);

            // The extension's path is what follows `/http/`: `/http` alone is no route at all.
            if (match === null) {
                return c.json({ error: "not found" }, 404);
            }

            const { outgoing, incoming } = c.env;

            try {
                await extensions.serveHttp(decodeURIComponent(match[1] ?? ""), {
                    request: incoming,
                    response: outgoing,
                    path: (match[2] ?? "/") + url.search,
                });
            } catch (error) {
                if (outgoing.headersSent) {
                    outgoing.destroy();
                } else {
                    answer(outgoing, error instanceof ActionNotFound ? 404 : 500, {
                        error: error instanceof Error ? error.message : "extension HTTP failed",
                    });
                }
            }

            return RESPONSE_ALREADY_SENT;
        })
        .post("/api/extensions/:name/actions/:action", async (c) => {
            const pathname = new URL(c.req.url).pathname;

            // 400 for bad input, 404 for an unknown extension, action or session, 500 for any other failure.
            try {
                const parsed = parseActionBody(await readJson(c.env.incoming).catch(badBody));
                let session: SessionRef | null = null;

                if (parsed.session !== undefined) {
                    const opened = await attach(parsed.session);

                    if (opened === undefined) {
                        return c.json({ error: "no such session" }, 404);
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
                    segmentOf(EXTENSION_ACTION, pathname, 1),
                    segmentOf(EXTENSION_ACTION, pathname, 2),
                    { args: parsed.args, session },
                );

                return c.json({ result }, 200);
            } catch (error) {
                answerError(c.env.outgoing, error, "the action failed");

                return RESPONSE_ALREADY_SENT;
            }
        })
        .get("/api/extensions", (c) => {
            return c.json({
                installed: extensions.names,
                failed: extensions.failed,
                extensions: extensions.list,
            });
        })
        .put("/api/extensions/:name", async (c) => {
            const pathname = new URL(c.req.url).pathname;

            // 400 for a body that is not `{ enabled: boolean }`, 404 for an unknown folder.
            try {
                const parsed: unknown = await readJson(c.env.incoming).catch(badBody);
                const enabled: unknown =
                    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
                        ? Reflect.get(parsed, "enabled")
                        : undefined;

                if (typeof enabled !== "boolean") {
                    throw new ActionError("the body must be { enabled: boolean }");
                }

                return c.json(
                    await extensions.setEnabled(segmentOf(EXTENSION_TOGGLE, pathname, 1), enabled),
                    200,
                );
            } catch (error) {
                answerError(c.env.outgoing, error, "the change failed");

                return RESPONSE_ALREADY_SENT;
            }
        });
}
