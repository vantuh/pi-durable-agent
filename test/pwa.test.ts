import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

import { precacheUrls, renderWorker, roleColor, shellVersion, workerFacets } from "../pwa.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const template = read("../web/sw.js");
const ORIGIN = "https://agent.test";

type Handler = (event: unknown) => void;

// Enough of the two classes for the worker's install step: headers it can copy and edit, and a body it
// passes through. `arrayBuffer` hands back the string it was given, which is all the assertions read.
class FakeHeaders {
    #values = new Map<string, string>();

    constructor(init: Record<string, string> | FakeHeaders) {
        const entries = init instanceof FakeHeaders ? init.#values.entries() : Object.entries(init);

        for (const [name, value] of entries) {
            this.#values.set(name.toLowerCase(), value);
        }
    }

    get(name: string): string | null {
        return this.#values.get(name.toLowerCase()) ?? null;
    }

    delete(name: string): void {
        this.#values.delete(name.toLowerCase());
    }
}

class FakeResponse {
    readonly body: string;
    readonly status: number;
    readonly headers: FakeHeaders;
    readonly ok: boolean;

    constructor(body: string, init: { status: number; headers: FakeHeaders }) {
        this.body = body;
        this.status = init.status;
        this.headers = init.headers;
        this.ok = init.status >= 200 && init.status < 300;
    }

    arrayBuffer(): Promise<string> {
        return Promise.resolve(this.body);
    }

    static error(): string {
        return "error";
    }
}

// Runs the real worker source against an in-memory Cache Storage.
function loadWorker(version: string, stores: Map<string, Map<string, FakeResponse>>) {
    const handlers = new Map<string, Handler>();
    const fetched: string[] = [];
    let online = true;
    const cacheOf = (name: string) => {
        const store = stores.get(name) ?? new Map<string, FakeResponse>();

        stores.set(name, store);

        return {
            put: (url: string, response: FakeResponse) => {
                store.set(new URL(url, ORIGIN).pathname, response);

                return Promise.resolve();
            },
            match: (path: string) => Promise.resolve(store.get(path)),
        };
    };
    const scope = {
        self: {
            location: { origin: ORIGIN },
            addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
        },
        caches: {
            open: (name: string) => Promise.resolve(cacheOf(name)),
            keys: () => Promise.resolve([...stores.keys()]),
            delete: (name: string) => Promise.resolve(stores.delete(name)),
        },
        // A real precache response is compressed on the wire: these headers are what the Cache API must
        // not carry into a replay of the decoded body.
        fetch: (request: { url: string }) => {
            fetched.push(request.url);

            return online
                ? Promise.resolve(
                      new FakeResponse(`network:${request.url}`, {
                          status: 200,
                          headers: new FakeHeaders({
                              "content-type": "text/javascript",
                              "content-encoding": "br",
                              "content-length": "9",
                          }),
                      }),
                  )
                : Promise.reject(new Error("offline"));
        },
        Request: class {
            url: string;
            constructor(url: string) {
                this.url = new URL(url, ORIGIN).href;
            }
        },
        Headers: FakeHeaders,
        Response: FakeResponse,
        URL,
    };

    vm.runInNewContext(renderWorker(template, version, ["/", "/assets/app-1.js"]), scope);

    const run = async (type: string, event: Record<string, unknown>) => {
        let waited: Promise<unknown> | undefined;
        let responded: Promise<unknown> | undefined;

        handlers.get(type)?.({
            ...event,
            waitUntil: (p: Promise<unknown>) => (waited = p),
            respondWith: (p: Promise<unknown>) => (responded = p),
        });
        await waited;

        return { responded: responded && (await responded) };
    };

    return {
        run,
        fetched,
        handlers,
        setOnline: (value: boolean) => (online = value),
        request: (path: string, init: { method?: string; mode?: string } = {}) => ({
            request: { url: ORIGIN + path, method: "GET", mode: "cors", ...init },
        }),
    };
}

void describe("service worker", () => {
    const bodyOf = (value: unknown): string =>
        value instanceof FakeResponse ? value.body : String(value);

    void it("never answers API, other-origin, non-GET or non-root navigation requests", async () => {
        const worker = loadWorker("v1", new Map());

        for (const event of [
            worker.request("/api/events"),
            worker.request("/api/uploads", { method: "POST" }),
            worker.request("/api/sessions", { mode: "navigate" }),
            worker.request("/other", { mode: "navigate" }),
            { request: { url: "https://elsewhere.test/assets/a.js", method: "GET", mode: "cors" } },
        ]) {
            assert.equal((await worker.run("fetch", event)).responded, undefined);
        }
    });

    void it("serves the root shell offline, and the live page when online", async () => {
        const stores = new Map<string, Map<string, FakeResponse>>();
        const worker = loadWorker("v1", stores);

        await worker.run("install", {});

        const cached = stores.get("pi-durable-agent-shell-v1")?.get("/");

        assert.ok(cached !== undefined, "the install stored the shell");

        const online = await worker.run("fetch", worker.request("/", { mode: "navigate" }));

        assert.notEqual(online.responded, cached, "online, the page comes from the network");
        assert.equal(bodyOf(online.responded), `network:${ORIGIN}/`);

        worker.setOnline(false);
        assert.equal(
            (await worker.run("fetch", worker.request("/", { mode: "navigate" }))).responded,
            cached,
            "offline, it comes from the cache",
        );
    });

    void it("serves precached assets from cache and others from the network", async () => {
        const worker = loadWorker("v1", new Map());

        await worker.run("install", {});

        const before = worker.fetched.length;

        assert.equal(
            bodyOf((await worker.run("fetch", worker.request("/assets/app-1.js"))).responded),
            `network:${ORIGIN}/assets/app-1.js`,
        );
        assert.equal(worker.fetched.length, before, "a precached asset is not fetched again");
        assert.equal(
            bodyOf((await worker.run("fetch", worker.request("/assets/lazy-9.js"))).responded),
            `network:${ORIGIN}/assets/lazy-9.js`,
        );
        assert.equal(
            worker.fetched.length,
            before + 1,
            "a lazy chunk still comes from the network",
        );
    });

    void it("drops the headers of the compressed wire response, so a replay is decodable", async () => {
        const stores = new Map<string, Map<string, FakeResponse>>();

        await loadWorker("v1", stores).run("install", {});

        const cached = [...(stores.get("pi-durable-agent-shell-v1")?.values() ?? [])];

        assert.equal(cached.length, 2, "the whole precache is stored");

        for (const response of cached) {
            assert.equal(
                response.headers.get("content-encoding"),
                null,
                "a decoded body cannot claim brotli",
            );
            assert.equal(response.headers.get("content-length"), null);
            assert.equal(
                response.headers.get("content-type"),
                "text/javascript",
                "every other header stays",
            );
        }
    });

    void it("does not skip waiting, and removes only older caches of this app on activate", async () => {
        const stores = new Map<string, Map<string, FakeResponse>>([
            ["pi-durable-agent-shell-v0", new Map<string, FakeResponse>()],
            ["shell-v0", new Map<string, FakeResponse>()],
            ["other-app", new Map<string, FakeResponse>()],
        ]);
        const worker = loadWorker("v1", stores);

        await worker.run("install", {});
        await worker.run("activate", {});
        assert.deepEqual([...stores.keys()].sort(), [
            "other-app",
            "pi-durable-agent-shell-v1",
            "shell-v0",
        ]);
        assert.doesNotMatch(template, /skipWaiting\(|clients\.claim\(/);
    });
});

void describe("pwa build helpers", () => {
    void it("resolves roles through the real theme files, per flavour", () => {
        const styles = read("../web/src/styles/styles.css");
        const palette = read("../web/src/styles/catppuccin.css");
        const paletteValue = (flavour: string, name: string) =>
            palette
                .split(`data-flavour="${flavour}"`)[1]
                ?.match(new RegExp(`--ctp-${name}:\\s*(#[0-9a-f]+)`, "i"))?.[1];

        assert.equal(roleColor(styles, palette, "canvas", "mocha"), paletteValue("mocha", "base"));
        assert.equal(roleColor(styles, palette, "panel", "latte"), paletteValue("latte", "mantle"));
        assert.notEqual(
            roleColor(styles, palette, "canvas", "mocha"),
            roleColor(styles, palette, "canvas", "latte"),
        );
        assert.throws(() => roleColor(styles, palette, "missing", "mocha"));
    });

    void it("changes the version when any shell input changes", () => {
        const base = shellVersion(["worker", "manifest", "<html>a</html>", Buffer.from([1, 2])]);

        assert.equal(
            base,
            shellVersion(["worker", "manifest", "<html>a</html>", Buffer.from([1, 2])]),
        );
        assert.notEqual(
            base,
            shellVersion(["worker", "manifest", "<html>b</html>", Buffer.from([1, 2])]),
        );
        assert.notEqual(
            base,
            shellVersion(["worker", "manifest", "<html>a</html>", Buffer.from([1, 3])]),
        );
        assert.notEqual(shellVersion(["ab", "c"]), shellVersion(["a", "bc"]));
    });

    void it("precaches the static import graph, not lazy chunks or fonts", () => {
        const css = new Set(["assets/index-1.css"]);
        const urls = precacheUrls({
            "assets/index-1.js": {
                isEntry: true,
                fileName: "assets/index-1.js",
                imports: ["assets/vendor-2.js"],
                viteMetadata: {
                    importedCss: css,
                    importedAssets: new Set(["assets/Mono-1.woff2"]),
                },
            },
            "assets/vendor-2.js": { isEntry: false, fileName: "assets/vendor-2.js", imports: [] },
            "assets/shiki-lang-3.js": {
                isEntry: false,
                fileName: "assets/shiki-lang-3.js",
                imports: [],
            },
        });

        assert.ok(
            urls.includes("/assets/index-1.js") &&
                urls.includes("/assets/vendor-2.js") &&
                urls.includes("/assets/index-1.css"),
        );
        assert.ok(!urls.some((url) => url.includes("shiki")));
        assert.ok(!urls.some((url) => url.endsWith(".woff2")));
        assert.ok(urls.includes("/") && urls.includes("/icons/apple-touch-icon.png"));
    });
});

void describe("worker facets", () => {
    const root = mkdtempSync(join(tmpdir(), "pwa-facets-"));
    const put = (folder: string, file: string, text: string): void => {
        mkdirSync(dirname(join(root, folder, file)), { recursive: true });
        writeFileSync(join(root, folder, file), text);
    };

    void it("reads assets/sw.js of normal folders in order and skips . and _ folders", () => {
        put("b", "assets/sw.js", "const x = 2;");
        put("a", "assets/sw.js", "const x = 1;");
        put("_c", "assets/sw.js", "skip");
        put(".d", "assets/sw.js", "skip");
        put("e", "server.ts", "no worker");
        put("f", "sw.js", "not in assets");

        assert.deepEqual(workerFacets(root), ["const x = 1;", "const x = 2;"]);
    });

    void it("a removed folder is absent on the next read", () => {
        rmSync(join(root, "b"), { recursive: true });
        assert.deepEqual(workerFacets(root), ["const x = 1;"]);
        rmSync(root, { recursive: true });
    });

    void it("wraps each facet so names do not clash, and the hash sees facet text", () => {
        const text = renderWorker(template, "v", ["/"], ["const x = 1;", "const x = 2;"]);

        vm.runInNewContext(text, {
            self: { addEventListener: () => undefined },
            caches: {},
            URL,
        });
        assert.notEqual(
            shellVersion([template, "const x = 1;"]),
            shellVersion([template, "const x = 2;"]),
        );
    });
});
