/**
 * The only way in: the host gate, the built shell, the same-origin gate, then the routes. Every answer that is
 * JSON goes back through Hono; a stream, a file's bytes and an extension's own handler write the response and
 * say so.
 */

import { homedir } from "node:os";

import { Hono } from "hono";

import { buildShell } from "./build.ts";
import { type ApiEnv, RESPONSE_ALREADY_SENT, routeFailed } from "./http.ts";
import { conversationRoutes } from "./routes/conversation.ts";
import { extensionRoutes } from "./routes/extensions.ts";
import { fileRoutes } from "./routes/files.ts";
import { modelRoutes } from "./routes/models.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { knownHost, sameOrigin } from "./same-origin.ts";
import { serveStatic } from "./static.ts";

/**
 * The whole surface: the gates, then every route. `boot` mounts it once the state the routes read exists, and
 * the listener serves this same instance, so this return type is the app's type, not a table of regexes.
 */
export function mountRoutes(deps: {
    /** The built web shell, served for a path outside `/api/`. */
    dist: string;
    /** The session list has to be read again after a route that changed a row. */
    listChanged: (id?: number) => void;
    model: string;
    rootId: () => number;
    /** Ends the process so the supervisor starts it again; undefined when nothing supervises it. */
    restart: (() => void) | undefined;
    conversation: Parameters<typeof conversationRoutes>[0];
    sessions: Parameters<typeof sessionRoutes>[0];
    models: Parameters<typeof modelRoutes>[0];
    files: Parameters<typeof fileRoutes>[0];
    extensions: Parameters<typeof extensionRoutes>[0];
}) {
    const { restart } = deps;
    const app = new Hono<ApiEnv>();

    app.notFound((c) => {
        // No route took the request, so the session list has nothing to refresh.
        c.set("unmatched", true);

        return c.json({ error: "not found" }, 404);
    });

    app.use("*", async (c, next) => {
        const { incoming, outgoing } = c.env;

        if (!knownHost(incoming.headers.host)) {
            return c.json({ error: "unknown host" }, 403);
        }

        if (!c.req.path.startsWith("/api/")) {
            await serveStatic(deps.dist, incoming, outgoing);

            return RESPONSE_ALREADY_SENT;
        }

        if (!sameOrigin(incoming.headers)) {
            return c.json({ error: "cross-origin requests are not allowed" }, 403);
        }

        // Hono answers HEAD from the GET route; before, only an extension's own HTTP took every method, and the
        // rest of the API is as unknown to HEAD as it was.
        if (c.req.method === "HEAD" && !c.req.path.startsWith("/api/extensions/")) {
            return c.json({ error: "not found" }, 404);
        }

        c.set("unmatched", false);

        return await next();
    });

    app.use("*", async (c, next) => {
        await next();

        // `onError` answers an exception and resolves `next()`: a route that threw changed nothing the list shows.
        if (c.get("unmatched") || c.error !== undefined) {
            return;
        }

        // An extension changes a row only through the host, which sends the list itself; a panel
        // that polls an action every second must not resend every row to every device.
        if (c.req.method !== "GET" && !c.req.path.startsWith("/api/extensions/")) {
            deps.listChanged(c.get("changedSession"));
        }
    });

    app.onError(routeFailed);

    return app
        .route("/", conversationRoutes(deps.conversation))
        .route("/", sessionRoutes(deps.sessions))
        .route("/", modelRoutes(deps.models))
        .route("/", fileRoutes(deps.files))
        .route("/", extensionRoutes(deps.extensions))
        .post(
            // The app's rebuild button. The files are read from `dist/` per request, so the new
            // shell is in force without a restart; the answer comes when the build is over.
            "/api/build",
            async (c) => c.json(await buildShell()),
        )
        .post(
            // The app's restart button; 409 without the supervisor, which would leave nothing to start it.
            "/api/restart",
            (c) => {
                if (restart === undefined) {
                    return c.json(
                        {
                            error: "start it with pnpm serve or pnpm start to restart it from the app",
                        },
                        409,
                    );
                }

                setTimeout(restart, 100);

                return c.json({ ok: true });
            },
        )
        .get("/api/health", (c) =>
            c.json({
                ok: true,
                model: deps.model,
                cwd: process.cwd(),
                home: homedir(),
                session: deps.rootId(),
            }),
        );
}
