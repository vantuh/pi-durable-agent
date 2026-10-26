import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

import { precacheUrls, renderWorker, roleColor, shellVersion, workerFacets } from "../pwa.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const template = read("../web/sw.js");
const ORIGIN = "https://agent.test";

type Handler = (event: unknown) => void;

// Runs the real worker source against an in-memory Cache Storage.
function loadWorker(version: string, stores: Map<string, Map<string, string>>) {
    const handlers = new Map<string, Handler>();
    const fetched: string[] = [];
    let online = true;
    const cacheOf = (name: string) => {
        const store = stores.get(name) ?? new Map<string, string>();

        stores.set(name, store);

        return {
            addAll: (requests: { url: string }[]) => {
                for (const { url } of requests) {
                    store.set(new URL(url, ORIGIN).pathname, `cached:${url}`);
                }

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
        fetch: (request: { url: string }) => {
            fetched.push(request.url);

            return online
                ? Promise.resolve(`network:${request.url}`)
                : Promise.reject(new Error("offline"));
        },
        Request: class {
            url: string;
            constructor(url: string) {
                this.url = url;
            }
        },
        Response: { error: () => "error" },
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
        const worker = loadWorker("v1", new Map());

        await worker.run("install", {});
        assert.equal(
            (await worker.run("fetch", worker.request("/", { mode: "navigate" }))).responded,
            `network:${ORIGIN}/`,
        );
        worker.setOnline(false);
        assert.equal(
            (await worker.run("fetch", worker.request("/", { mode: "navigate" }))).responded,
            "cached:/",
        );
    });

    void it("serves precached assets from cache and others from the network", async () => {
        const worker = loadWorker("v1", new Map());

        await worker.run("install", {});
        assert.equal(
            (await worker.run("fetch", worker.request("/assets/app-1.js"))).responded,
            "cached:/assets/app-1.js",
        );
        assert.equal(
            (await worker.run("fetch", worker.request("/assets/lazy-9.js"))).responded,
            `network:${ORIGIN}/assets/lazy-9.js`,
        );
    });

    void it("does not skip waiting, and removes only older caches of this app on activate", async () => {
        const stores = new Map([
            ["pi-durable-agent-shell-v0", new Map<string, string>()],
            ["shell-v0", new Map<string, string>()],
            ["other-app", new Map<string, string>()],
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
        const styles = read("../web/src/styles.css");
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

    void it("precaches the static import graph, not lazy chunks", () => {
        const css = new Set(["assets/index-1.css"]);
        const urls = precacheUrls({
            "assets/index-1.js": {
                isEntry: true,
                fileName: "assets/index-1.js",
                imports: ["assets/vendor-2.js"],
                viteMetadata: { importedCss: css, importedAssets: new Set() },
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
        assert.ok(urls.includes("/") && urls.includes("/icons/apple-touch-icon.png"));
    });
});

void describe("worker facets", () => {
    const root = mkdtempSync(join(tmpdir(), "pwa-facets-"));
    const put = (folder: string, file: string, text: string): void => {
        mkdirSync(join(root, folder), { recursive: true });
        writeFileSync(join(root, folder, file), text);
    };

    void it("reads sw.js of normal folders in order and skips . and _ folders", () => {
        put("b", "sw.js", "const x = 2;");
        put("a", "sw.js", "const x = 1;");
        put("_c", "sw.js", "skip");
        put(".d", "sw.js", "skip");
        put("e", "server.ts", "no worker");

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
