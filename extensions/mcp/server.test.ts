import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { testHost } from "../../test/fixtures/host.ts";
import { schemasSent } from "../../test/fixtures/tool-schemas.ts";
import createMcp from "./server.ts";
import { Connections } from "./server/connections.ts";

// A real MCP server over stdio, one tool: echo.
const SERVER = `
require("readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    const reply = (result) => id !== undefined && console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
    if (method === "initialize") reply({ protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } });
    if (method === "tools/list") reply({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    if (method === "tools/call") reply({ content: [{ type: "text", text: "echo: " + params.arguments.word + (process.env.SUFFIX ?? "") }] });
});`;

void describe("mcp connections", () => {
    let dir: string;
    let config: string;
    let state: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "mcp-"));
        config = join(dir, "mcp.json");
        state = join(dir, "data", "enabled.json");
        await writeFile(
            config,
            JSON.stringify({
                mcpServers: {
                    echo: { command: process.execPath, args: ["-e", SERVER] },
                    sleeper: { command: process.execPath, args: ["-e", SERVER], enabled: false },
                },
            }),
        );
    });

    afterEach(() => rm(dir, { recursive: true, force: true }));

    void it("connects the servers that are on and calls a tool", async () => {
        const connections = new Connections(config, state, () => undefined);

        await connections.start();

        try {
            const { servers } = connections.list();

            assert.deepEqual(
                servers.map(({ name, status, tools }) => [name, status, tools]),
                [
                    ["echo", "connected", 1],
                    ["sleeper", "off", 0],
                ],
            );

            const live = connections.connected()[0]?.[1];
            const result = await live?.client.callTool("echo", { word: "hi" });

            assert.deepEqual(result?.content, [{ type: "text", text: "echo: hi" }]);
        } finally {
            await connections.close();
        }
    });

    void it("runs a `!` value's command without holding the server while it runs", async () => {
        await writeFile(
            config,
            JSON.stringify({
                mcpServers: {
                    echo: {
                        command: process.execPath,
                        args: ["-e", SERVER],
                        env: { SUFFIX: "!sleep 0.3; printf ' -shell'" },
                    },
                },
            }),
        );

        const connections = new Connections(config, state, () => undefined);
        const before = performance.now();
        const started = connections.start();
        const blocked = performance.now() - before;

        try {
            await started;
            assert.ok(blocked < 150, `start held the server for ${String(blocked)} ms`);

            const result = await connections.connected()[0]?.[1].client.callTool("echo", {
                word: "hi",
            });

            assert.deepEqual(result?.content, [{ type: "text", text: "echo: hi-shell" }]);
        } finally {
            await connections.close();
        }
    });

    void it("switches a server off and on, and remembers the choice", async () => {
        const first = new Connections(config, state, () => undefined);

        await first.setEnabled("sleeper", true);
        await first.setEnabled("echo", false);
        await first.close();

        const second = new Connections(config, state, () => undefined);

        await second.start();

        try {
            assert.deepEqual(
                second.list().servers.map(({ name, status }) => [name, status]),
                [
                    ["echo", "off"],
                    ["sleeper", "connected"],
                ],
            );
            await assert.rejects(second.setEnabled("nope", true), /no MCP server named "nope"/);
        } finally {
            await second.close();
        }
    });

    void it("keeps both of two switches made at once", async () => {
        const first = new Connections(config, state, () => undefined);

        try {
            // Neither switch waits for the other: the second must read what the first wrote.
            await Promise.all([first.setEnabled("sleeper", true), first.setEnabled("echo", false)]);
        } finally {
            await first.close();
        }

        const second = new Connections(config, state, () => undefined);

        await second.start();

        try {
            assert.deepEqual(
                second.list().servers.map(({ name, status }) => [name, status]),
                [
                    ["echo", "off"],
                    ["sleeper", "connected"],
                ],
            );
        } finally {
            await second.close();
        }
    });

    void it("shows a server that cannot start as an error, and a broken file as a problem", async () => {
        await writeFile(
            config,
            JSON.stringify({ mcpServers: { bad: { command: "/nonexistent/mcp-server" } } }),
        );

        const connections = new Connections(config, state, () => undefined);

        await connections.start();
        assert.equal(connections.list().servers[0]?.status, "error");
        await connections.close();

        await writeFile(config, "{ not json");
        assert.match(connections.list().problem ?? "", /mcp\.json/);
    });

    void it("reports a failed `!` command by field and exit code, never its command line or output", async () => {
        const lines: string[] = [];

        await writeFile(
            config,
            JSON.stringify({
                mcpServers: {
                    bad: {
                        url: "http://127.0.0.1:1/mcp",
                        headers: {
                            Authorization:
                                "!echo stderr-secret-9f3 >&2; echo stdout-secret-7b1; exit 3 # argv-secret-4c8",
                        },
                    },
                },
            }),
        );

        const connections = new Connections(config, state, (line) => lines.push(line));

        await connections.start();

        const listed = connections.list();
        const shown = JSON.stringify([listed, lines]);

        await connections.close();

        assert.equal(listed.servers[0]?.status, "error");
        assert.match(shown, /headers\.Authorization/);
        assert.match(shown, /exit code 3/);
        assert.doesNotMatch(shown, /secret/);
    });
});

void describe("mcp parameters", () => {
    void it("hand the model this schema", async () => {
        // The factory reads Pi's mcp.json and starts its servers: point it at an empty folder.
        const dir = await mkdtemp(join(tmpdir(), "mcp-schema-"));
        const previous = process.env["PI_CODING_AGENT_DIR"];
        const disposers: (() => unknown)[] = [];

        process.env["PI_CODING_AGENT_DIR"] = dir;

        try {
            const extension = createMcp(
                testHost({
                    dataDir: dir,
                    onDispose: (dispose) => {
                        disposers.push(dispose);
                    },
                }),
            );

            assert.deepEqual(schemasSent(extension), {
                mcp: {
                    type: "object",
                    properties: {
                        server: { type: "string", description: "A server name from the list." },
                        tool: { type: "string", description: "A tool name of that server." },
                        arguments: {
                            type: "object",
                            additionalProperties: {},
                            description: "The tool's arguments, as its input schema asks.",
                        },
                    },
                },
            });

            await Promise.all(disposers.map((dispose) => dispose()));
        } finally {
            if (previous === undefined) {
                delete process.env["PI_CODING_AGENT_DIR"];
            } else {
                process.env["PI_CODING_AGENT_DIR"] = previous;
            }

            await rm(dir, { recursive: true, force: true });
        }
    });
});
