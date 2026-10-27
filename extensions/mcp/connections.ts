import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
    McpClient,
    StdioTransport,
    StreamableHttpTransport,
    type Tool,
} from "@earendil-works/pi-mcp";

import type { McpState, ServerInfo } from "./refs.ts";

type Raw = Record<string, unknown>;
type Live = { client: McpClient; status: ServerInfo["status"]; error?: string; tools: Tool[] };

function isRecord(value: unknown): value is Raw {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Undefined for a missing file; a broken one throws. */
function readJson(file: string): unknown {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }

        throw error;
    }
}

/** A value starting with `!` is a shell command whose output is the value, as in Pi's other config files. */
function strings(table: unknown): Record<string, string> {
    if (!isRecord(table)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(table).flatMap(([key, value]) =>
            typeof value !== "string"
                ? []
                : [
                      [
                          key,
                          value.startsWith("!")
                              ? execFileSync("/bin/sh", ["-c", value.slice(1)], {
                                    encoding: "utf8",
                                    timeout: 10_000,
                                    stdio: ["ignore", "pipe", "ignore"],
                                }).trim()
                              : value,
                      ],
                  ],
        ),
    );
}

function transportOf(raw: Raw) {
    if (typeof raw["command"] === "string") {
        return new StdioTransport({
            command: raw["command"],
            args: Array.isArray(raw["args"])
                ? raw["args"].filter((arg) => typeof arg === "string")
                : [],
            env: strings(raw["env"]),
        });
    }

    if (typeof raw["url"] === "string") {
        return new StreamableHttpTransport({
            url: raw["url"],
            headers: strings(raw["headers"]),
        });
    }

    throw new Error("needs a command or a url");
}

/**
 * The servers of Pi's `mcp.json` and the connection to each. The file says which servers exist and
 * their default; the switch in the app is kept apart, so Pi's own file is never written.
 */
export class Connections {
    readonly #config: string;
    readonly #state: string;
    readonly #log: (line: string) => void;
    readonly #live = new Map<string, Live>();

    constructor(config: string, state: string, log: (line: string) => void) {
        this.#config = config;
        this.#state = state;
        this.#log = log;
    }

    #servers(): [string, Raw][] {
        const file = readJson(this.#config);
        const all = isRecord(file) ? file["mcpServers"] : undefined;

        return isRecord(all)
            ? Object.entries(all).filter((entry): entry is [string, Raw] => isRecord(entry[1]))
            : [];
    }

    #saved(): Record<string, unknown> {
        try {
            const saved = readJson(this.#state);

            return isRecord(saved) ? saved : {};
        } catch {
            return {};
        }
    }

    #isOn(name: string, raw: Raw): boolean {
        const saved = this.#saved()[name];

        return typeof saved === "boolean" ? saved : raw["enabled"] !== false;
    }

    /** Connects every server that is on. A failure shows in `list`; it does not throw. */
    async start(): Promise<void> {
        await Promise.all(
            this.#servers()
                .filter(([name, raw]) => this.#isOn(name, raw))
                .map(([name, raw]) => this.#connect(name, raw)),
        );
    }

    list(): McpState {
        try {
            return {
                servers: this.#servers().map(([name, raw]) => {
                    const live = this.#live.get(name);

                    return {
                        name,
                        target:
                            [raw["url"], raw["command"]].find((one) => typeof one === "string") ??
                            "",
                        status: live?.status ?? "off",
                        tools: live?.tools.length ?? 0,
                        ...(live?.error === undefined ? {} : { error: live.error }),
                    };
                }),
            };
        } catch (error) {
            return { servers: [], problem: `${this.#config}: ${errorText(error)}` };
        }
    }

    /** Resolves once the connection is up or has failed. */
    async setEnabled(name: string, enabled: boolean): Promise<void> {
        const found = this.#servers().find(([one]) => one === name);

        if (found === undefined) {
            throw new Error(`no MCP server named "${name}"`);
        }

        mkdirSync(dirname(this.#state), { recursive: true });
        writeFileSync(this.#state, JSON.stringify({ ...this.#saved(), [name]: enabled }));
        await this.#drop(name);

        if (enabled) {
            await this.#connect(name, found[1]);
        }
    }

    connected(): [string, Live][] {
        return [...this.#live].filter(([, live]) => live.status === "connected");
    }

    async close(): Promise<void> {
        await Promise.all([...this.#live.keys()].map((name) => this.#drop(name)));
    }

    async #drop(name: string): Promise<void> {
        const live = this.#live.get(name);

        this.#live.delete(name);
        await live?.client.close().catch(() => undefined);
    }

    async #connect(name: string, raw: Raw): Promise<void> {
        const client = new McpClient({ name: "pi-durable-agent", version: "1" });
        const live: Live = { client, status: "connecting", tools: [] };

        this.#live.set(name, live);

        try {
            await client.connect(transportOf(raw));
            live.tools = await client.listTools();
            live.status = "connected";
            client.onClose(() => {
                live.status = "error";
                live.error = "the connection closed";
            });
        } catch (error) {
            live.status = "error";
            live.error = errorText(error);

            // Switched off while connecting: the failure is the switch, not news.
            if (this.#live.get(name) === live) {
                this.#log(`mcp ${name}: ${live.error}`);
            }

            await client.close().catch(() => undefined);
        }
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
