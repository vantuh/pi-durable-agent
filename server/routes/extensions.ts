/** The extension list and switches, and each extension's actions and raw HTTP. */

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Hono } from "hono";
import { z } from "zod";

import { ActionNotFound, type Extensions, type SessionRef } from "../extensions.ts";
import { answer, type ApiEnv, failureOf, RESPONSE_ALREADY_SENT } from "../http.ts";
import type { Opened } from "../sessions.ts";
import { jsonBody, PositiveId } from "../validate.ts";

/** An object or nothing: what an action is called with, and the session it is called from. */
export const ActionBody = z.object({
    session: PositiveId.optional(),
    args: z.unknown().optional(),
});
const ToggleBody = z.object({ enabled: z.boolean() });

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
        .post(
            "/api/extensions/:name/actions/:action",
            jsonBody(
                ActionBody,
                (path) =>
                    path[0] === "session"
                        ? "session must be a positive integer"
                        : "the body must be a JSON object",
                { whole: true, marksSession: false },
            ),
            async (c) => {
                const pathname = new URL(c.req.url).pathname;
                const parsed = c.req.valid("json");

                // 400 for bad input, 404 for an unknown extension, action or session, 500 for any other failure.
                try {
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
                    const { status, ...body } = failureOf(error, "the action failed");

                    return c.json(body, status);
                }
            },
        )
        .get("/api/extensions", (c) => {
            return c.json({
                installed: extensions.names,
                failed: extensions.failed,
                extensions: extensions.list,
            });
        })
        .put(
            "/api/extensions/:name",
            jsonBody(ToggleBody, "the body must be { enabled: boolean }", { marksSession: false }),
            async (c) => {
                const pathname = new URL(c.req.url).pathname;

                // 404 for an unknown folder.
                try {
                    return c.json(
                        await extensions.setEnabled(
                            segmentOf(EXTENSION_TOGGLE, pathname, 1),
                            c.req.valid("json").enabled,
                        ),
                        200,
                    );
                } catch (error) {
                    const { status, ...body } = failureOf(error, "the change failed");

                    return c.json(body, status);
                }
            },
        );
}
