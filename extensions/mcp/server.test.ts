import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Connections } from "./connections.ts";

// A real MCP server over stdio, one tool: echo.
const SERVER = `
require("readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    const reply = (result) => id !== undefined && console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
    if (method === "initialize") reply({ protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } });
    if (method === "tools/list") reply({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    if (method === "tools/call") reply({ content: [{ type: "text", text: "echo: " + params.arguments.word }] });
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
});
