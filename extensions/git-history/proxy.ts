import { request as httpRequest } from "node:http";
import { gzipSync } from "node:zlib";

import type { HttpHandler } from "../../server/extensions.ts";
import { embedHtml } from "./bridge.ts";
import type { Reviews } from "./reviews.ts";

const HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
]);

/** Only Plannotator's preferences may cross the process boundary, never app auth cookies. */
export function plannotatorCookies(raw: string): string {
    return raw
        .split(";")
        .map((part) => part.trim())
        .filter((part) => /^plannotator-[A-Za-z0-9_.-]+=/.test(part))
        .join("; ");
}
export function scopedCookies(raw: readonly string[], prefix: string): string[] {
    return raw
        .filter((cookie) => /^plannotator-[A-Za-z0-9_.-]+=/.test(cookie))
        .map((cookie) => {
            const parts = cookie.split(";").filter((part) => !/^\s*(domain|path)=/i.test(part));
            return [...parts, ` Path=${prefix}`].join(";");
        });
}

/** Fixed, server-owned upstream only: the caller can never supply a host or port. */
export function reviewProxy(reviews: Reviews): HttpHandler {
    return ({ request, response, path }) =>
        new Promise<void>((resolve) => {
            const match = /^\/([0-9a-f]{48})(\/[^#]*)$/.exec(path);
            const token = match?.[1];
            const job = token === undefined ? undefined : reviews.find(token);
            if (job === undefined || job.port === undefined || job.view.state !== "running") {
                response.writeHead(410, {
                    "content-type": "text/plain",
                    "cache-control": "no-store",
                });
                response.end("This review has ended. Return to Git history to reopen it.");
                resolve();
                return;
            }
            const upstream = `http://127.0.0.1:${String(job.port)}`;
            const publicOrigin = request.headers.origin;
            // Core has already refused foreign origins. Never forward app cookies or credentials.
            const headers: Record<string, string> = {
                host: `127.0.0.1:${String(job.port)}`,
                "accept-encoding": "identity",
            };
            for (const name of [
                "content-type",
                "accept",
                "last-event-id",
                "range",
                "if-none-match",
            ]) {
                const value = request.headers[name];
                if (typeof value === "string") {
                    headers[name] = value;
                }
            }
            const cookies = plannotatorCookies(request.headers.cookie ?? "");
            if (cookies !== "") {
                headers["cookie"] = cookies;
            }
            if (publicOrigin !== undefined) {
                headers["origin"] = upstream;
            }
            if (request.headers["sec-fetch-site"] === "same-origin") {
                headers["sec-fetch-site"] = "same-origin";
            }
            const proxy = httpRequest(
                {
                    hostname: "127.0.0.1",
                    port: job.port,
                    path: match?.[2] ?? "/",
                    method: request.method,
                    headers,
                },
                (remote) => {
                    const out: Record<string, string | string[]> = {
                        "cache-control": "no-store",
                        "referrer-policy": "no-referrer",
                        "x-content-type-options": "nosniff",
                        "content-security-policy": "frame-ancestors 'self'; object-src 'none'",
                    };
                    for (const [name, value] of Object.entries(remote.headers)) {
                        if (
                            value !== undefined &&
                            !HOP.has(name) &&
                            ![
                                "set-cookie",
                                "content-encoding",
                                "content-security-policy",
                                "x-frame-options",
                                "cache-control",
                            ].includes(name)
                        ) {
                            out[name] = value;
                        }
                    }
                    const responseCookies = scopedCookies(
                        remote.headers["set-cookie"] ?? [],
                        reviews.prefix,
                    );
                    if (responseCookies.length > 0) {
                        out["set-cookie"] = responseCookies;
                    }
                    if (typeof out["location"] === "string") {
                        const location = new URL(out["location"], upstream);
                        if (location.origin === upstream) {
                            out["location"] =
                                `${reviews.prefix}/${token ?? ""}${location.pathname}${location.search}`;
                        }
                    }
                    if (String(remote.headers["content-type"]).includes("text/html")) {
                        const chunks: Buffer[] = [];
                        let bytes = 0;
                        remote.on("data", (chunk: Buffer) => {
                            bytes += chunk.length;
                            if (bytes > 32 * 1024 * 1024) {
                                remote.destroy(new Error("Plannotator HTML exceeds 32 MiB."));
                                return;
                            }
                            chunks.push(chunk);
                        });
                        remote.on("end", () => {
                            try {
                                const html = embedHtml(
                                    Buffer.concat(chunks).toString("utf8"),
                                    `${reviews.prefix}/${token ?? ""}`,
                                );
                                const gzip = /\bgzip\b/.test(
                                    request.headers["accept-encoding"] ?? "",
                                );
                                const body = gzip ? gzipSync(html) : Buffer.from(html);
                                if (gzip) {
                                    out["content-encoding"] = "gzip";
                                }
                                out["vary"] = "Accept-Encoding";
                                out["content-length"] = String(body.length);
                                response.writeHead(remote.statusCode ?? 200, out);
                                response.end(body);
                            } catch {
                                if (!response.headersSent) {
                                    response.writeHead(502);
                                    response.end("Could not embed Plannotator.");
                                } else {
                                    response.destroy();
                                }
                            }
                            resolve();
                        });
                    } else {
                        // Pipe SSE and binary uploads/downloads without buffering or dropping backpressure.
                        response.writeHead(remote.statusCode ?? 200, out);
                        response.flushHeaders();
                        remote.pipe(response);
                        remote.once("end", resolve);
                    }
                    remote.once("error", () => {
                        response.destroy();
                        resolve();
                    });
                },
            );
            proxy.once("error", () => {
                if (!response.headersSent) {
                    response.writeHead(502, { "content-type": "text/plain" });
                    response.end("The Plannotator process is unavailable.");
                } else {
                    response.destroy();
                }
                resolve();
            });
            response.once("close", () => {
                proxy.destroy();
                resolve();
            });
            request.once("aborted", () => {
                proxy.destroy();
                resolve();
            });
            request.pipe(proxy);
        });
}
