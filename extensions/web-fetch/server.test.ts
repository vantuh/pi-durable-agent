import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

import { MAX_CHARS, fetchPage, format, type Page } from "./page.ts";

type Route = (response: ServerResponse) => void;

type Site = { url: string; close: () => Promise<void> };

/** A real local server: the boundary is HTTP itself, so nothing is stubbed. */
async function serve(routes: Record<string, Route>): Promise<Site> {
    const server = createServer((request, response) => {
        const route = routes[request.url ?? "/"];
        if (route === undefined) {
            response.writeHead(404, { "content-type": "text/plain" }).end("not found");
            return;
        }
        route(response);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("the test server has no port");
    }

    return {
        url: `http://127.0.0.1:${address.port}`,
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        },
    };
}

/** The served page, or a failed assertion instead of a union every test has to narrow. */
async function page(url: string, signal?: AbortSignal): Promise<Page> {
    const fetched = await fetchPage(url, signal);
    assert.equal(fetched.kind, "page", fetched.kind === "error" ? fetched.message : "");
    if (fetched.kind !== "page") {
        throw new Error("unreachable");
    }
    return fetched;
}

async function failure(url: string, signal?: AbortSignal): Promise<string> {
    const fetched = await fetchPage(url, signal);
    assert.equal(fetched.kind, "error");
    if (fetched.kind !== "error") {
        throw new Error("unreachable");
    }
    return fetched.message;
}

/** The Markdown a call returned, between the two-line header and the truncation note. */
function markdownOf(text: string): string {
    const note = text.indexOf("\n\n[Truncated:");
    return text.slice(text.indexOf("\n\n") + 2, note === -1 ? undefined : note);
}

const ARTICLE = `<!doctype html><html><head><title>Node release notes</title></head><body>
    <nav><a href="/">Home</a> NAVTEXT</nav>
    <script>var note = "SCRIPTTEXT";</script>
    <article>
        <h1>Releases</h1>
        <p>Every even major version becomes a long term support line; odd ones retire sooner.</p>
        <pre><code>node --version</code></pre>
        <p><a href="/docs/lts">LTS docs</a></p>
        <p>${"Padding so Readability has enough text to accept the page. ".repeat(12)}</p>
    </article>
    <footer>FOOTERTEXT</footer>
</body></html>`;

void describe("web-fetch html", () => {
    void it("keeps the article as Markdown, with nav, footer and script gone", async () => {
        const site = await serve({
            "/article": (response) => {
                response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                response.end(ARTICLE);
            },
        });

        try {
            const fetched = await page(`${site.url}/article`);
            const text = format(fetched, 0).text;

            assert.equal(fetched.title, "Node release notes");
            assert.match(
                text,
                /^# Node release notes\nURL: http:\/\/127\.0\.0\.1:\d+\/article\n\n/,
            );
            assert.match(text, /^#{1,3} Releases$/m);
            assert.match(text, /Every even major version becomes a long term support line/);
            assert.match(text, /```\nnode --version\n```/);
            assert.match(text, new RegExp(`\\[LTS docs\\]\\(${site.url}/docs/lts\\)`));
            assert.doesNotMatch(text, /NAVTEXT|SCRIPTTEXT|FOOTERTEXT/);
            assert.doesNotMatch(text, /\n{3,}/);
        } finally {
            await site.close();
        }
    });

    void it("falls back to the body when Readability finds no article", async () => {
        const site = await serve({
            "/thin": (response) => {
                response.writeHead(200, { "content-type": "text/html" });
                response.end(
                    `<html><head><title>Status</title><style>STYLETEXT</style></head><body><nav>NAVTEXT</nav><script>SCRIPTTEXT</script><main><p>All systems are up. <a href="/status/1">Detail</a></p></main><footer>FOOTERTEXT</footer></body></html>`,
                );
            },
        });

        try {
            const text = format(await page(`${site.url}/thin`), 0).text;

            assert.match(text, /^# Status\n/);
            assert.match(
                text,
                /All systems are up\. \[Detail\]\(http:\/\/127\.0\.0\.1:\d+\/status\/1\)/,
            );
            assert.doesNotMatch(text, /NAVTEXT|FOOTERTEXT|STYLETEXT|SCRIPTTEXT/);
        } finally {
            await site.close();
        }
    });

    void it("reports the url a redirect ended at", async () => {
        const site = await serve({
            "/old": (response) => {
                response.writeHead(302, { location: "/article" }).end();
            },
            "/article": (response) => {
                response.writeHead(200, { "content-type": "text/html" });
                response.end(ARTICLE);
            },
        });

        try {
            const fetched = await page(`${site.url}/old`);

            assert.equal(fetched.url, `${site.url}/article`);
            assert.match(format(fetched, 0).text, new RegExp(`^URL: ${site.url}/article$`, "m"));
        } finally {
            await site.close();
        }
    });
});

void describe("web-fetch paging", () => {
    const RAW = "0123456789".repeat(7_000);

    void it("truncates with the numbers to continue from, and continues without a gap", async () => {
        const site = await serve({
            "/long": (response) => {
                response.writeHead(200, { "content-type": "text/plain" });
                response.end(RAW);
            },
        });

        try {
            const fetched = await page(`${site.url}/long`);
            const first = format(fetched, 0);

            assert.match(
                first.text,
                /\[Truncated: showing characters 0–40000 of 70000\. Call web_fetch again with offset: 40000 for more\.\]$/,
            );

            const second = format(fetched, MAX_CHARS);

            assert.equal(markdownOf(first.text) + markdownOf(second.text), RAW);
            assert.doesNotMatch(second.text, /Truncated/);

            const past = format(fetched, RAW.length);

            assert.equal(past.isError, true);
            assert.match(past.text, /has 70000 characters/);
        } finally {
            await site.close();
        }
    });
});

void describe("web-fetch content types", () => {
    void it("returns text as it is", async () => {
        const site = await serve({
            "/notes.md": (response) => {
                response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
                response.end("# Notes\n\nOne line.\n");
            },
        });

        try {
            const fetched = await page(`${site.url}/notes.md`);

            assert.equal(fetched.title, "");
            assert.equal(
                format(fetched, 0).text,
                `URL: ${site.url}/notes.md\n\n# Notes\n\nOne line.`,
            );
        } finally {
            await site.close();
        }
    });

    void it("refuses a type it cannot read", async () => {
        const site = await serve({
            "/paper.pdf": (response) => {
                response.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
            },
        });

        try {
            assert.equal(
                await failure(`${site.url}/paper.pdf`),
                "unsupported content type: application/pdf",
            );
        } finally {
            await site.close();
        }
    });

    void it("says the status of a failed response, and nothing else", async () => {
        const site = await serve({});

        try {
            assert.equal(await failure(`${site.url}/gone`), "HTTP 404");
        } finally {
            await site.close();
        }
    });
});

void describe("web-fetch limits", () => {
    void it("stops reading a body over 5 MiB", async () => {
        const site = await serve({
            "/huge": (response) => {
                // The client cancels mid-body, so the response's own write error is expected here.
                response.on("error", () => {
                    /* the socket is already gone */
                });
                response.writeHead(200, { "content-type": "text/plain" });
                response.end(Buffer.alloc(6 * 1024 * 1024, "a"));
            },
        });

        try {
            assert.equal(await failure(`${site.url}/huge`), "page too large: over 5 MiB");
        } finally {
            await site.close();
        }
    });

    void it("stops when the caller aborts during the request", async () => {
        const site = await serve({
            "/stall": (response) => {
                response.writeHead(200, { "content-type": "text/html" });
                response.write("<html><body><p>slow");
            },
        });
        const controller = new AbortController();
        const aborted = setTimeout(() => controller.abort(), 50);

        try {
            assert.equal(
                await failure(`${site.url}/stall`, controller.signal),
                "web_fetch was stopped.",
            );
        } finally {
            clearTimeout(aborted);
            await site.close();
        }
    });
});
