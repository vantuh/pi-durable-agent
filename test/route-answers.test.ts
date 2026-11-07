// What the JSON routes answer to input they refuse, on the real server. A change to how a route reads
// its input must leave every row of these tables as it is.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { recordOf } from "../shared/guards.ts";
import { startServer, type TestServer } from "./fixtures/server.ts";

let server: TestServer;
let root = 0;

before(async () => {
    server = await startServer();
    root = Number(recordOf(await (await fetch(`${server.base}/api/health`)).json())?.["session"]);
});

after(async () => {
    await server.stop();
});

type Call = {
    method?: string;
    path: string;
    /** Sent as JSON; a string is sent as it is, to test a body that is not JSON. */
    body?: unknown;
};

async function answerTo({
    method = "POST",
    path,
    body,
}: Call): Promise<{ status: number; body: unknown }> {
    const response = await fetch(server.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined
            ? {}
            : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });

    return { status: response.status, body: await response.json() };
}

async function expectAnswers(
    rows: readonly { name: string; call: Call; status: number; body: unknown }[],
): Promise<void> {
    for (const row of rows) {
        const answer = await answerTo(row.call);

        assert.deepEqual(
            answer,
            { status: row.status, body: row.body },
            `${row.name}: ${row.call.method ?? "POST"} ${row.call.path}`,
        );
    }
}

const MISSING = 999_999;

void describe("session routes refuse bad input", () => {
    void it("answers 400 or 404 with the same words", async () => {
        await expectAnswers([
            {
                name: "no body",
                call: { path: "/api/sessions/archive" },
                status: 400,
                body: { error: "Expected a session id and archived boolean" },
            },
            ...[{}, { session: 1 }, { session: root, archived: "yes" }, { archived: true }].map(
                (body) => ({
                    name: JSON.stringify(body),
                    call: { path: "/api/sessions/archive", body },
                    status: 400,
                    body: { error: "Expected a session id and archived boolean" },
                }),
            ),
            ...[-1, 0, 1.5, "1", null, 2 ** 60].map((session) => ({
                name: `session ${JSON.stringify(session)}`,
                call: { path: "/api/sessions/archive", body: { session, archived: true } },
                status: 400,
                body: { error: "Expected a session id and archived boolean" },
            })),
            {
                name: "unknown session",
                call: { path: "/api/sessions/archive", body: { session: MISSING, archived: true } },
                status: 404,
                body: { error: "Session not found" },
            },
            ...[{}, { session: "1" }, { session: 0 }].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/sessions/delete", body },
                status: 400,
                body: { error: "Expected a session id" },
            })),
            {
                name: "unknown session",
                call: { path: "/api/sessions/delete", body: { session: MISSING } },
                status: 404,
                body: { error: "Session not found" },
            },
            ...[{}, { session: root }, { session: root, title: 5 }, { title: "x" }].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/sessions/title", body },
                status: 400,
                body: { error: "Expected a session id and a title string" },
            })),
            {
                name: "unknown session",
                call: { path: "/api/sessions/title", body: { session: MISSING, title: "x" } },
                status: 404,
                body: { error: "Session not found" },
            },
            ...[{}, { session: -3 }].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/sessions/seen", body },
                status: 400,
                body: { error: "Expected a session id" },
            })),
            {
                name: "unknown session",
                call: { path: "/api/sessions/seen", body: { session: MISSING } },
                status: 404,
                body: { error: "Session not found" },
            },
        ]);
    });

    void it("takes what it can use and ignores the rest", async () => {
        for (const body of [undefined, {}, [], null, 7, { cwd: 5 }, { cwd: null, session: "x" }]) {
            const answer = await answerTo({
                path: "/api/sessions",
                ...(body === undefined ? {} : { body }),
            });

            assert.equal(answer.status, 201, JSON.stringify(body));
            assert.equal(typeof recordOf(answer.body)?.["session"], "number");
        }
    });

    void it("trims a title and cuts it to 80 characters", async () => {
        const created = await answerTo({ path: "/api/sessions", body: {} });
        const session = recordOf(created.body)?.["session"];

        assert.deepEqual(
            await answerTo({
                path: "/api/sessions/title",
                body: { session, title: `  ${"a".repeat(100)}  ` },
            }),
            { status: 200, body: { ok: true } },
        );

        const listed = recordOf(await (await fetch(`${server.base}/api/sessions`)).json())?.[
            "sessions"
        ];

        assert.ok(Array.isArray(listed));

        const row = listed.map(recordOf).find((entry) => entry?.["id"] === session);

        assert.equal(row?.["title"], "a".repeat(80));
    });
});

void describe("model routes refuse bad input", () => {
    void it("answers 400 with the same words", async () => {
        const both = { error: "provider and modelId are required" };
        const bodies = [{}, { provider: "p" }, { modelId: "m" }, { provider: 1, modelId: "m" }];

        for (const method of ["POST", "DELETE"]) {
            await expectAnswers(
                bodies.map((body) => ({
                    name: JSON.stringify(body),
                    call: { method, path: "/api/scoped", body },
                    status: 400,
                    body: both,
                })),
            );
        }

        const levels = { error: "model and thinkingLevel are required" };

        await expectAnswers(
            [
                {},
                { thinkingLevel: "off" },
                { model: { provider: "p", modelId: "m" } },
                { model: { provider: "p", modelId: "m" }, thinkingLevel: "loud" },
                { model: { provider: "p", modelId: "m" }, thinkingLevel: 5 },
                { model: { provider: "p" }, thinkingLevel: "off" },
                { model: "p/m", thinkingLevel: "off" },
                { model: [], thinkingLevel: "off" },
            ].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/default", body },
                status: 400,
                body: levels,
            })),
        );
    });

    void it("echoes what it took", async () => {
        await expectAnswers([
            {
                name: "scoped",
                call: { path: "/api/scoped", body: { provider: "p", modelId: "m", extra: 1 } },
                status: 200,
                body: { provider: "p", modelId: "m" },
            },
            {
                name: "unscoped",
                call: {
                    method: "DELETE",
                    path: "/api/scoped",
                    body: { provider: "p", modelId: "m" },
                },
                status: 200,
                body: { provider: "p", modelId: "m" },
            },
            {
                name: "default",
                call: {
                    path: "/api/default",
                    body: { model: { provider: "p", modelId: "m" }, thinkingLevel: "high" },
                },
                status: 200,
                body: { provider: "p", modelId: "m", thinkingLevel: "high" },
            },
        ]);
    });
});

void describe("file routes", () => {
    void it("keeps the favourites that are strings", async () => {
        await expectAnswers([
            {
                name: "mixed",
                call: {
                    method: "PUT",
                    path: "/api/favourites",
                    body: { folders: ["/a", 5, null, "/b"] },
                },
                status: 200,
                body: { folders: ["/a", "/b"] },
            },
            {
                name: "not a list",
                call: { method: "PUT", path: "/api/favourites", body: { folders: "/a" } },
                status: 200,
                body: { folders: [] },
            },
            {
                name: "no body",
                call: { method: "PUT", path: "/api/favourites" },
                status: 200,
                body: { folders: [] },
            },
            {
                name: "read back",
                call: { method: "GET", path: "/api/favourites" },
                status: 200,
                body: { folders: [] },
            },
        ]);
    });

    void it("keeps the parts of a folder layout that are right", async () => {
        await expectAnswers([
            {
                name: "a bad colour is no colour, a bad list is empty",
                call: {
                    method: "PUT",
                    path: "/api/folder-layout",
                    body: {
                        order: ["/a", 5],
                        collapsed: "/b",
                        folders: { "/a": { name: "Main", color: "plaid" } },
                    },
                },
                status: 200,
                body: { order: ["/a"], collapsed: [], folders: { "/a": { name: "Main" } } },
            },
            {
                name: "no body",
                call: { method: "PUT", path: "/api/folder-layout" },
                status: 200,
                body: { order: [], collapsed: [], folders: {} },
            },
        ]);
    });

    void it("lists a folder, the home folder by default", async () => {
        const home = await answerTo({ method: "GET", path: "/api/fs" });

        assert.equal(home.status, 200);
        assert.equal(recordOf(home.body)?.["path"], recordOf(home.body)?.["home"]);

        const tilde = await answerTo({ method: "GET", path: "/api/fs?path=~" });

        assert.equal(recordOf(tilde.body)?.["path"], recordOf(home.body)?.["home"]);

        const empty = await answerTo({ method: "GET", path: "/api/fs?path=" });

        assert.equal(empty.status, 200);
        assert.ok(String(recordOf(empty.body)?.["path"]).endsWith("cwd"));

        await expectAnswers([
            {
                name: "missing folder",
                call: { method: "GET", path: "/api/fs?path=/no/such/folder" },
                status: 400,
                body: { error: "cannot read that folder" },
            },
            {
                name: "no path",
                call: { method: "GET", path: "/api/uploads" },
                status: 403,
                body: { error: "not an uploaded file" },
            },
        ]);
    });

    void it("shows hidden folders only for hidden=1", async () => {
        await mkdir(join(server.cwd, ".hidden-folder"));

        const names = async (query: string): Promise<unknown[]> => {
            const answer = await answerTo({
                method: "GET",
                path: `/api/fs?path=${encodeURIComponent(server.cwd)}${query}`,
            });
            const dirs = recordOf(answer.body)?.["dirs"];

            assert.ok(Array.isArray(dirs));

            return dirs.map((dir) => recordOf(dir)?.["name"]);
        };

        assert.ok(!(await names("")).includes(".hidden-folder"));
        assert.ok(!(await names("&hidden=true")).includes(".hidden-folder"));
        assert.ok((await names("&hidden=1")).includes(".hidden-folder"));
    });
});

void describe("conversation routes refuse bad input", () => {
    const badSession = { error: "session must be a positive integer" };
    const noSession = { error: "no such session" };

    void it("answers a bad session id in a body with 400, and an unknown one with 404", async () => {
        for (const path of ["/api/messages", "/api/abort", "/api/agent", "/api/commands"]) {
            await expectAnswers(
                ["x", 0, -1, 1.5, false].map((session) => ({
                    name: `session ${JSON.stringify(session)}`,
                    call: { path, body: { session, text: "hi" } },
                    status: 400,
                    body: badSession,
                })),
            );
        }

        await expectAnswers([
            {
                name: "queued",
                call: { path: "/api/queued/withdraw", body: { session: "x", id: 1 } },
                status: 400,
                body: badSession,
            },
            ...[{}, { session: root }, { id: 0 }, { id: 1.5 }, { id: "1" }].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/queued/withdraw", body },
                status: 400,
                body: { error: "id must be a positive integer" },
            })),
            {
                name: "messages",
                call: { path: "/api/messages", body: { session: MISSING, text: "hi" } },
                status: 404,
                body: noSession,
            },
            {
                name: "messages, no text: the session is looked up first",
                call: { path: "/api/messages", body: { session: MISSING } },
                status: 404,
                body: noSession,
            },
            {
                name: "agent",
                call: { path: "/api/agent", body: { session: MISSING } },
                status: 404,
                body: noSession,
            },
            {
                name: "commands",
                call: { path: "/api/commands", body: { session: MISSING } },
                status: 404,
                body: noSession,
            },
            {
                name: "queued",
                call: { path: "/api/queued/withdraw", body: { session: MISSING, id: 1 } },
                status: 404,
                body: noSession,
            },
        ]);
    });

    void it("needs text or a file to send, and takes the root session when none is named", async () => {
        const needsText = { error: "text is required" };

        await expectAnswers(
            [
                {},
                { text: "" },
                { text: "  \n" },
                { text: 5 },
                { session: null, text: " " },
                { session: root, files: [5] },
                { files: "a.txt" },
            ].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/messages", body },
                status: 400,
                body: needsText,
            })),
        );
    });

    void it("aborts and configures quietly", async () => {
        await expectAnswers([
            { name: "abort, root", call: { path: "/api/abort" }, status: 202, body: { ok: true } },
            {
                name: "abort, unknown",
                call: { path: "/api/abort", body: { session: MISSING } },
                status: 202,
                body: { ok: true },
            },
            {
                name: "agent, nothing usable",
                call: {
                    path: "/api/agent",
                    body: { model: { provider: 1 }, thinkingLevel: "loud" },
                },
                status: 202,
                body: { ok: true },
            },
        ]);
    });

    void it("reads the session of a query as the root one when it is not a positive integer", async () => {
        for (const query of [
            "",
            "?session=NaN",
            "?session=0",
            "?session=-2",
            "?session=",
            "?session=1.5",
        ]) {
            for (const path of ["/api/skills", "/api/project-files"]) {
                const answer = await answerTo({ method: "GET", path: path + query });

                assert.equal(answer.status, 200, path + query);
            }
        }

        const unknown = await answerTo({
            method: "GET",
            path: `/api/history?session=${String(MISSING)}`,
        });

        assert.deepEqual(unknown, { status: 404, body: noSession });

        const fallback = await answerTo({ method: "GET", path: "/api/history?session=NaN" });

        assert.equal(fallback.status, 200);
    });

    void it("refuses a history page that does not start at an entry", async () => {
        await expectAnswers(
            ["abc", "0", "-1", "", "1.5"].map((page) => ({
                name: `before=${page}`,
                call: { method: "GET", path: `/api/history?before=${page}` },
                status: 400,
                body: { error: "before must be a positive entry id" },
            })),
        );
        assert.equal(
            (await answerTo({ method: "GET", path: "/api/history?before=5" })).status,
            200,
        );
    });

    void it("needs a session, an entry and a picture index for a tool image", async () => {
        const required = { error: "session, entry and index are required" };
        const bad = [
            "",
            `?session=${String(root)}`,
            `?entry=1`,
            `?session=0&entry=1`,
            `?session=${String(root)}&entry=-1`,
            `?session=${String(root)}&entry=1&index=-1`,
            `?session=${String(root)}&entry=1&index=1.5`,
            `?session=${String(root)}&entry=1&index=x`,
        ];

        await expectAnswers(
            bad.map((query) => ({
                name: query,
                call: { method: "GET", path: `/api/entry-image${query}` },
                status: 400,
                body: required,
            })),
        );

        // A missing or empty index is the first picture: these get past the check and find no image.
        for (const index of ["", "&index=", "&index=0"]) {
            assert.deepEqual(
                await answerTo({
                    method: "GET",
                    path: `/api/entry-image?session=${String(root)}&entry=1${index}`,
                }),
                { status: 404, body: { error: "no such image" } },
                index,
            );
        }
    });

    void it("unknown command answers 400 with its reason", async () => {
        const answer = await answerTo({ path: "/api/commands", body: { name: "nope" } });

        assert.equal(answer.status, 400);
        assert.equal(typeof recordOf(answer.body)?.["error"], "string");
        assert.equal((await answerTo({ path: "/api/commands" })).status, 400);
    });
});

void describe("extension routes refuse bad input", () => {
    const object = { error: "the body must be a JSON object" };
    const session = { error: "session must be a positive integer" };
    const enabled = { error: "the body must be { enabled: boolean }" };

    void it("answers an action with a bad body with 400", async () => {
        await expectAnswers([
            ...[[], 5, '"x"', null].map((body) => ({
                name: JSON.stringify(body),
                call: { path: "/api/extensions/nothing/actions/go", body },
                status: 400,
                body: object,
            })),
            ...["1", 0, -1, 1.5, null, false].map((id) => ({
                name: `session ${JSON.stringify(id)}`,
                call: { path: "/api/extensions/nothing/actions/go", body: { session: id } },
                status: 400,
                body: session,
            })),
            {
                name: "not JSON",
                call: { path: "/api/extensions/nothing/actions/go", body: "{oops" },
                status: 400,
                body: { error: "body is not JSON" },
            },
            {
                name: "unknown session",
                call: { path: "/api/extensions/nothing/actions/go", body: { session: MISSING } },
                status: 404,
                body: { error: "no such session" },
            },
        ]);
    });

    void it("takes an action without a body to the extension lookup", async () => {
        for (const body of [undefined, {}, { args: [1] }]) {
            const answer = await answerTo({
                path: "/api/extensions/nothing/actions/go",
                ...(body === undefined ? {} : { body }),
            });

            assert.equal(answer.status, 404, JSON.stringify(body));
        }
    });

    void it("answers a switch with a bad body with 400", async () => {
        await expectAnswers([
            ...[undefined, {}, { enabled: "yes" }, { enabled: 1 }, [], 5, null].map((body) => ({
                name: JSON.stringify(body),
                call: {
                    method: "PUT",
                    path: "/api/extensions/nothing",
                    ...(body === undefined ? {} : { body }),
                },
                status: 400,
                body: enabled,
            })),
            {
                name: "not JSON",
                call: { method: "PUT", path: "/api/extensions/nothing", body: "{oops" },
                status: 400,
                body: { error: "body is not JSON" },
            },
        ]);
    });
});
