/**
 * MCP: the servers in Pi's own `mcp.json`, each with a switch in Settings.
 *
 * A server can have dozens of tools, so they are not offered one by one: Pi gets one tool, `mcp`,
 * to list the servers, read a server's tools, and call one. Switching a server off closes its
 * connection.
 */

import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { toLlmContent } from "@earendil-works/pi-mcp";
import { Type } from "typebox";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import { Connections } from "./connections.ts";

export const meta = {
    title: "MCP servers",
    description: "Connects to the servers in Pi's mcp.json; switch each one on or off in Settings.",
};

const GUIDE =
    "MCP servers may be connected. Call mcp with no arguments to list them, with a server to read its tools and their input schemas, and with a server, a tool and arguments to run one. Read a tool's schema before the first call.";

const instances = new WeakMap<Host, Connections>();

function connectionsOf(host: Host): Connections {
    const found = instances.get(host);

    if (found === undefined) {
        throw new Error("MCP is not running");
    }

    return found;
}

export const actions = (host: Host): Record<string, Action> => ({
    state: () => connectionsOf(host).list(),
    toggle: async ({ args }) => {
        if (
            typeof args !== "object" ||
            args === null ||
            !("name" in args) ||
            typeof args.name !== "string" ||
            !("enabled" in args) ||
            typeof args.enabled !== "boolean"
        ) {
            throw new ActionError("args must be { name: string, enabled: boolean }");
        }

        const connections = connectionsOf(host);

        try {
            await connections.setEnabled(args.name, args.enabled);
        } catch (error) {
            throw new ActionError(error instanceof Error ? error.message : String(error));
        }

        return connections.list();
    },
});

export default function createMcp(host: Host) {
    const connections = new Connections(
        join(getAgentDir(), "mcp.json"),
        join(host.dataDir, "mcp", "enabled.json"),
        host.log,
    );

    instances.set(host, connections);
    host.onDispose(() => connections.close());
    // A server may take long to start (a command may fetch its package): do not hold the install.
    void connections.start().catch((error: unknown) => {
        host.log(`mcp: ${error instanceof Error ? error.message : String(error)}`);
    });

    const mcp = defineTool({
        name: "mcp",
        description:
            "Use the connected MCP servers. No arguments: list the servers and their tools. With server: show its tools, with descriptions and input schemas. With server and tool: call it.",
        parameters: Type.Object({
            server: Type.Optional(Type.String({ description: "A server name from the list." })),
            tool: Type.Optional(Type.String({ description: "A tool name of that server." })),
            arguments: Type.Optional(
                Type.Record(Type.String(), Type.Unknown(), {
                    description: "The tool's arguments, as its input schema asks.",
                }),
            ),
        }),
        execute: async (args, _api, context) => {
            const text = (line: string, isError = false) => ({
                output: [{ type: "text" as const, text: line }],
                ...(isError ? { isError } : {}),
            });
            const all = connections.connected();

            if (args.server === undefined) {
                return text(
                    all.length === 0
                        ? "No MCP server is connected."
                        : all
                              .map(
                                  ([name, live]) =>
                                      `${name}: ${live.tools.map((tool) => tool.name).join(", ")}`,
                              )
                              .join("\n"),
                );
            }

            const found = all.find(([name]) => name === args.server)?.[1];

            if (found === undefined) {
                return text(`MCP server "${args.server}" is not connected.`, true);
            }

            if (args.tool === undefined) {
                return text(
                    found.tools
                        .map(
                            (tool) =>
                                `${tool.name}${tool.description === undefined ? "" : `: ${tool.description}`}\n${JSON.stringify(tool.inputSchema)}`,
                        )
                        .join("\n\n"),
                );
            }

            const result = await found.client.callTool(args.tool, args.arguments, {
                ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
            });
            const output = toLlmContent(result);

            return {
                output: output.length === 0 ? text("(no output)").output : output,
                ...(result.isError === true ? { isError: true } : {}),
            };
        },
    });

    return defineExtension({
        name: host.name,
        tools: [mcp],
        sections: [
            section("mcp", (input) =>
                input.agent.tools.some((tool) => tool.name === "mcp") ? GUIDE : undefined,
            ),
        ],
    });
}
