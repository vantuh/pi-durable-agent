// The browser's HTTP client (`web/src/lib/api.ts`, built on `hc`) against the real server: what each call
// sends on the wire, what it makes of the answer, and what it throws when the server refuses. The browser's
// relative URLs are pointed at the test server by a `fetch` shim, which also records every request.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { recordOf } from "../shared/guards.ts";
import {
    addScopedModel,
    conversationStreamPath,
    createSession,
    deleteSession,
    type ExtensionInfo,
    entryImageUrl,
    fetchHistory,
    type FolderPage,
    getFavourites,
    getHealth,
    listExtensions,
    listFolders,
    listModels,
    listProjectFiles,
    listSessions,
    listSkills,
    markSeen,
    rebuildShell,
    removeScopedModel,
    restartServer,
    runCommand,
    sendMessage,
    sessionsStreamPath,
    setAgent,
    setDefaultModel,
    setExtensionEnabled,
    setFavourites,
    setSessionArchived,
    setSessionTitle,
    stopRun,
    uploadFile,
    type UploadedFile,
    uploadUrl,
    withdrawQueued,
} from "../web/src/lib/api.ts";
import { startServer, type TestServer } from "./fixtures/server.ts";

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown };

let server: TestServer;
const browserFetch = globalThis.fetch;
let sent: Sent[] = [];
/** Where a request goes once it is recorded: the test server, unless a test stands something in for it. */
let forward = (url: string, init?: RequestInit): Promise<Response> =>
    browserFetch(new URL(url, server.base), init);

before(async () => {
    server = await startServer();
    globalThis.fetch = (input, init) => {
        // `hc` hands `fetch` the path as a string.
        if (typeof input !== "string") {
            throw new TypeError("the client should call fetch with a path");
        }

        sent.push({
            method: init?.method ?? "GET",
            url: input,
            headers: Object.fromEntries(new Headers(init?.headers)),
            body: init?.body,
        });

        return forward(input, init);
    };
});

after(async () => {
    globalThis.fetch = browserFetch;
    await server.stop();
});

/** The requests `action` makes, in order. */
async function requestsOf(action: () => Promise<unknown>): Promise<Sent[]> {
    sent = [];
    await action();

    return sent;
}

const MISSING = 999_999;
const JSON_HEADERS = { "content-type": "application/json" };

const get = (url: string): Sent => ({ method: "GET", url, headers: {}, body: undefined });
const post = (url: string, body: unknown): Sent => ({
    method: "POST",
    url,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
});

void describe("models", () => {
    const choice = {
        provider: "p",
        id: "m",
        name: "M",
        contextWindow: 1,
        reasoning: false,
        levels: [],
    };

    void it("lists the catalog with a default", async () => {
        assert.deepEqual(await requestsOf(() => listModels()), [get("/api/models")]);

        const models = await listModels();

        assert.ok(models.all.length > 0);
        assert.deepEqual(models.scoped, []);
        assert.equal(typeof models.default?.modelId, "string");
        assert.deepEqual(Object.keys(models.all[0] ?? {}).sort(), [
            "contextWindow",
            "id",
            "levels",
            "name",
            "provider",
            "reasoning",
        ]);
    });

    void it("sends the default and the scope as JSON, DELETE included", async () => {
        assert.deepEqual(
            await requestsOf(() =>
                setDefaultModel({ provider: "p", modelId: "m", thinkingLevel: "high" }),
            ),
            [
                {
                    method: "POST",
                    url: "/api/default",
                    headers: JSON_HEADERS,
                    body: JSON.stringify({
                        model: { provider: "p", modelId: "m" },
                        thinkingLevel: "high",
                    }),
                },
            ],
        );
        assert.deepEqual((await listModels()).default, {
            provider: "p",
            modelId: "m",
            thinkingLevel: "high",
        });

        const scope = JSON.stringify({ provider: "p", modelId: "m" });

        assert.deepEqual(await requestsOf(() => addScopedModel(choice)), [
            { method: "POST", url: "/api/scoped", headers: JSON_HEADERS, body: scope },
        ]);
        assert.deepEqual(await requestsOf(() => removeScopedModel(choice)), [
            { method: "DELETE", url: "/api/scoped", headers: JSON_HEADERS, body: scope },
        ]);
    });

    void it("throws the path and status when the level is not one", async () => {
        await assert.rejects(
            setDefaultModel({ provider: "p", modelId: "m", thinkingLevel: "loud" }),
            { message: "/api/default: 400" },
        );
    });
});

void describe("sessions", () => {
    void it("creates, renames, archives, marks and deletes a session with JSON bodies", async () => {
        let id = 0;

        assert.deepEqual(
            await requestsOf(async () => {
                id = await createSession(server.cwd);
            }),
            [
                {
                    method: "POST",
                    url: "/api/sessions",
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ cwd: server.cwd }),
                },
            ],
        );
        assert.ok(id > 0);

        assert.deepEqual(await requestsOf(() => setSessionTitle(id, "Renamed")), [
            {
                method: "POST",
                url: "/api/sessions/title",
                headers: JSON_HEADERS,
                body: JSON.stringify({ session: id, title: "Renamed" }),
            },
        ]);
        assert.equal((await listSessions()).find((row) => row.id === id)?.title, "Renamed");

        assert.deepEqual(await requestsOf(() => setSessionArchived(id, true)), [
            {
                method: "POST",
                url: "/api/sessions/archive",
                headers: JSON_HEADERS,
                body: JSON.stringify({ session: id, archived: true }),
            },
        ]);
        assert.equal((await listSessions()).find((row) => row.id === id)?.archived, true);

        assert.deepEqual(await requestsOf(() => markSeen(id)), [
            post("/api/sessions/seen", { session: id }),
        ]);
        assert.deepEqual(await requestsOf(() => deleteSession(id)), [
            post("/api/sessions/delete", { session: id }),
        ]);
        assert.deepEqual(await requestsOf(() => listSessions()), [get("/api/sessions")]);
        assert.equal(
            (await listSessions()).some((row) => row.id === id),
            false,
        );
    });

    void it("throws the path and status when the server refuses", async () => {
        await assert.rejects(setSessionTitle(999_999, "x"), {
            message: "/api/sessions/title: 404",
        });
        await assert.rejects(deleteSession(999_999), { message: "/api/sessions/delete: 404" });
    });
});

void describe("files", () => {
    void it("sends the favourites as JSON and reads them back", async () => {
        assert.deepEqual(await requestsOf(() => setFavourites(["/a", "/b c"])), [
            {
                method: "PUT",
                url: "/api/favourites",
                headers: JSON_HEADERS,
                body: JSON.stringify({ folders: ["/a", "/b c"] }),
            },
        ]);
        assert.deepEqual(await requestsOf(() => getFavourites()), [get("/api/favourites")]);
        assert.deepEqual(await getFavourites(), ["/a", "/b c"]);
    });

    void it("lists folders with the hidden flag as 1 or 0, and gives nothing for one it cannot read", async () => {
        await mkdir(join(server.cwd, ".hidden"), { recursive: true });

        let page: FolderPage | undefined;

        assert.deepEqual(
            await requestsOf(async () => {
                page = await listFolders(server.cwd, false);
            }),
            [
                {
                    method: "GET",
                    url: `/api/fs?path=${encodeURIComponent(server.cwd)}&hidden=0`,
                    headers: {},
                    body: undefined,
                },
            ],
        );
        assert.deepEqual(page?.dirs, [
            { name: "extensions", path: join(server.cwd, "extensions") },
        ]);
        assert.equal(page?.parent, join(server.cwd, ".."));
        assert.deepEqual(
            (await listFolders(server.cwd, true))?.dirs.map((dir) => dir.name),
            [".hidden", "extensions"],
        );
        assert.equal(await listFolders(join(server.cwd, "missing"), false), undefined);
    });

    void it("uploads the bytes as the body, with the name in a header, and reads them back from uploadUrl", async () => {
        const file = new File(["hello"], "a b.png", { type: "image/png" });
        let saved: UploadedFile | undefined;

        const requests = await requestsOf(async () => {
            saved = await uploadFile(file);
        });

        assert.deepEqual(requests, [
            {
                method: "POST",
                url: "/api/files",
                headers: { "x-filename": "a%20b.png" },
                body: file,
            },
        ]);
        assert.deepEqual(
            { name: saved?.name, size: saved?.size, mime: saved?.mime },
            { name: "a b.png", size: 5, mime: "image/png" },
        );

        const read = await fetch(uploadUrl(saved?.path ?? ""));

        assert.equal(read.status, 200);
        assert.equal(read.headers.get("content-type"), "image/png");
        assert.equal(await read.text(), "hello");
    });
});

void describe("conversation", () => {
    let root = 0;
    let other = 0;

    before(async () => {
        const health: unknown = await (await browserFetch(`${server.base}/api/health`)).json();

        root = Number(recordOf(health)?.["session"]);

        const project = join(server.root, "project");
        const skill = join(project, ".agents", "skills", "zz-demo");

        await mkdir(skill, { recursive: true });
        await writeFile(
            join(skill, "SKILL.md"),
            "---\nname: zz-demo\ndescription: Demo skill\n---\nDo the demo.\n",
        );
        await writeFile(join(project, "a.txt"), "a");
        other = await createSession(project);
    });

    void it("builds the URLs the screen used to write by hand", () => {
        assert.equal(sessionsStreamPath(), "/api/sessions/events");
        assert.equal(conversationStreamPath(7), "/api/events?session=7");
        assert.equal(entryImageUrl(1, 2, 0), "/api/entry-image?session=1&entry=2&index=0");
        assert.equal(uploadUrl("/a b/c"), "/api/uploads?path=%2Fa+b%2Fc");
    });

    void it("opens the event stream at the path it builds", async () => {
        const stream = await fetch(conversationStreamPath(root));
        const reader = stream.body?.getReader();
        const first = await reader?.read();

        assert.equal(stream.headers.get("content-type"), "text/event-stream");
        assert.match(new TextDecoder().decode(first?.value), /^data: /);
        await reader?.cancel();
    });

    void it("sends a message as JSON with only the fields it has, and says whether it was taken", async () => {
        assert.deepEqual(
            await requestsOf(async () => {
                assert.equal(await sendMessage(MISSING, "hi", ["/f"], "steer"), false);
            }),
            [
                {
                    method: "POST",
                    url: "/api/messages",
                    headers: JSON_HEADERS,
                    body: JSON.stringify({
                        session: MISSING,
                        text: "hi",
                        files: ["/f"],
                        mode: "steer",
                    }),
                },
            ],
        );
        assert.deepEqual(await requestsOf(() => sendMessage(MISSING, "hi", [])), [
            {
                method: "POST",
                url: "/api/messages",
                headers: JSON_HEADERS,
                body: JSON.stringify({ session: MISSING, text: "hi", files: [] }),
            },
        ]);
    });

    void it("stops a run without reading the answer", async () => {
        assert.deepEqual(await requestsOf(() => stopRun(root)), [
            {
                method: "POST",
                url: "/api/abort",
                headers: JSON_HEADERS,
                body: JSON.stringify({ session: root }),
            },
        ]);
        await stopRun(MISSING);
    });

    void it("changes the agent, and throws the path and status when the session is not there", async () => {
        assert.deepEqual(await requestsOf(() => setAgent(root, { thinkingLevel: "off" })), [
            {
                method: "POST",
                url: "/api/agent",
                headers: JSON_HEADERS,
                body: JSON.stringify({ session: root, thinkingLevel: "off" }),
            },
        ]);
        await assert.rejects(setAgent(MISSING, {}), { message: "/api/agent: 404" });
    });

    void it("changes the model and the level of the session it names", async () => {
        assert.deepEqual(
            await requestsOf(() =>
                setAgent(other, { model: { provider: "p", modelId: "m" }, thinkingLevel: "off" }),
            ),
            [
                post("/api/agent", {
                    session: other,
                    model: { provider: "p", modelId: "m" },
                    thinkingLevel: "off",
                }),
            ],
        );
    });

    void it("throws the server's own words when a command fails", async () => {
        assert.deepEqual(
            await requestsOf(() =>
                assert.rejects(runCommand(other, "nope", "x y"), {
                    message: 'no command named "nope"',
                }),
            ),
            [post("/api/commands", { session: other, name: "nope", args: "x y" })],
        );
        await assert.rejects(runCommand(MISSING, "compact", ""), { message: "no such session" });
    });

    void it("answers where a withdrawn message got to, or nothing when the call failed", async () => {
        assert.deepEqual(
            await requestsOf(async () => {
                assert.equal(await withdrawQueued(other, 7), "not_found");
            }),
            [post("/api/queued/withdraw", { session: other, id: 7 })],
        );
        assert.equal(await withdrawQueued(MISSING, 1), undefined);
    });

    void it("reads the skills and the files of the session it names, not of the root one", async () => {
        assert.deepEqual(await listSkills(root), []);
        assert.deepEqual(await listProjectFiles(root), []);

        let skills: Awaited<ReturnType<typeof listSkills>> = [];
        let files: string[] = [];

        assert.deepEqual(
            await requestsOf(async () => {
                skills = await listSkills(other);
            }),
            [get(`/api/skills?session=${String(other)}`)],
        );
        assert.deepEqual(
            await requestsOf(async () => {
                files = await listProjectFiles(other);
            }),
            [get(`/api/project-files?session=${String(other)}`)],
        );
        assert.deepEqual(skills, [{ name: "zz-demo", description: "Demo skill" }]);
        assert.deepEqual(files.toSorted(), [".agents/skills/zz-demo/SKILL.md", "a.txt"]);
    });

    void it("reads a page of history of the session it names", async () => {
        assert.deepEqual(await requestsOf(() => fetchHistory(other, 5)), [
            get(`/api/history?session=${String(other)}&before=5`),
        ]);
        assert.deepEqual(await fetchHistory(other, 5), { entries: [], more: false });
        await assert.rejects(fetchHistory(root, 0), {
            message: `/api/history?session=${String(root)}&before=0: 400`,
        });
    });
});

void describe("extensions", () => {
    void it("lists the folders and switches one off and on with a JSON body", async () => {
        await mkdir(join(server.cwd, "extensions", "sample"));
        await writeFile(
            join(server.cwd, "extensions", "sample", "server.ts"),
            "export default function (host) { return { name: host.name }; }",
        );

        // The loader picks a new folder up on its own, a moment after it is written.
        for (let tries = 0; tries < 100; tries += 1) {
            if ((await listExtensions()).some((info) => info.installed)) {
                break;
            }

            await new Promise((done) => setTimeout(done, 50));
        }

        assert.deepEqual(await requestsOf(() => listExtensions()), [get("/api/extensions")]);

        const listed = (await listExtensions()).find((info) => info.name === "sample");

        assert.deepEqual(
            { name: listed?.name, enabled: listed?.enabled, installed: listed?.installed },
            { name: "sample", enabled: true, installed: true },
        );
        assert.equal(typeof listed?.title, "string");

        let off: ExtensionInfo | undefined;

        assert.deepEqual(
            await requestsOf(async () => {
                off = await setExtensionEnabled("sample", false);
            }),
            [
                {
                    method: "PUT",
                    url: "/api/extensions/sample",
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ enabled: false }),
                },
            ],
        );
        assert.equal(off?.enabled, false);
        assert.equal((await setExtensionEnabled("sample", true)).enabled, true);
    });

    void it("throws the server's sentence when the change is refused", async () => {
        await assert.rejects(setExtensionEnabled("nope", true), {
            message: 'no extension "nope"',
        });
        // The name is encoded, so it reaches the route as one segment.
        await assert.rejects(setExtensionEnabled("a b/c", true), {
            message: 'no extension "a b/c"',
        });
    });
});

void describe("health and restart", () => {
    void it("reads the working folder and the home folder", async () => {
        assert.deepEqual(await requestsOf(() => getHealth()), [get("/api/health")]);

        const health = await getHealth();

        assert.equal(health?.home, server.root);
        assert.equal(typeof health?.cwd, "string");
    });

    void it("gives nothing when the server cannot be reached", async () => {
        const reachable = globalThis.fetch;

        globalThis.fetch = () => Promise.reject(new TypeError("fetch failed"));

        try {
            assert.equal(await getHealth(), undefined);
        } finally {
            globalThis.fetch = reachable;
        }
    });

    void it("throws the path and status when there is no supervisor to restart it", async () => {
        assert.deepEqual(
            await requestsOf(() =>
                assert.rejects(restartServer(), { message: "/api/restart: 409" }),
            ),
            [{ method: "POST", url: "/api/restart", headers: {}, body: undefined }],
        );
    });
});

void describe("rebuilding the shell", () => {
    void it("posts without a body and hands back the build's answer, against a recording fake", async () => {
        // Never the real server: a build would overwrite the working `dist/`.
        const real = forward;

        forward = () => Promise.resolve(Response.json({ ok: false, log: "src/x.ts: boom" }));

        try {
            let result;

            assert.deepEqual(
                await requestsOf(async () => {
                    result = await rebuildShell();
                }),
                [{ method: "POST", url: "/api/build", headers: {}, body: undefined }],
            );
            assert.deepEqual(result, { ok: false, log: "src/x.ts: boom" });
        } finally {
            forward = real;
        }
    });
});
