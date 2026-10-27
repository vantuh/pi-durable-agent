import { actionRef } from "../../shared/extension-api.ts";

const STATUSES = ["off", "connecting", "connected", "error"] as const;

export type ServerInfo = {
    name: string;
    /** The command or URL; never its arguments, environment or headers, which may hold secrets. */
    target: string;
    status: (typeof STATUSES)[number];
    error?: string;
    tools: number;
};

export type McpState = { servers: ServerInfo[]; problem?: string };

function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new Error("the MCP state is malformed");
    }

    return Object.fromEntries(Object.entries(value));
}

function parseServer(value: unknown): ServerInfo {
    const { name, target, status, tools, error } = object(value);
    const known = STATUSES.find((one) => one === status);

    if (
        typeof name !== "string" ||
        typeof target !== "string" ||
        typeof tools !== "number" ||
        known === undefined
    ) {
        throw new Error("the MCP state is malformed");
    }

    return { name, target, tools, status: known, ...(typeof error === "string" ? { error } : {}) };
}

function parseState(value: unknown): McpState {
    const { servers, problem } = object(value);

    if (!Array.isArray(servers)) {
        throw new Error("the MCP state is malformed");
    }

    return {
        servers: servers.map(parseServer),
        ...(typeof problem === "string" ? { problem } : {}),
    };
}

export const state = actionRef<undefined, McpState>("mcp", "state", parseState);

export const toggle = actionRef<{ name: string; enabled: boolean }, McpState>(
    "mcp",
    "toggle",
    parseState,
);
