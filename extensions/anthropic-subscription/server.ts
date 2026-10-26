import { createHash } from "node:crypto";

import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/extensions.ts";
import { DEFAULT_VERSION, type Diagnostics } from "./refs.ts";
import { oauthTransport } from "./transport.ts";

const states = new WeakMap<Host, Diagnostics>();

export const actions = (host: Host): Record<string, Action> => ({
    diagnostics: () => states.get(host),
});

export const meta = {
    title: "Anthropic subscription",
    description:
        "Adds Claude Code billing identity to Anthropic OAuth requests. API keys are unchanged; subscription billing is not guaranteed.",
};

const MARKER = "x-anthropic-billing-header:";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Billing recipe used by pi-anthropic-auth and Pi Pocket; this is not a real Claude Code client. */
export function shapeRequest(payload: unknown, version: string): unknown {
    if (!record(payload) || !Array.isArray(payload["system"])) {
        return undefined;
    }
    const system: unknown[] = payload["system"];
    if (
        system.some(
            (block) =>
                record(block) &&
                typeof block["text"] === "string" &&
                block["text"].startsWith(MARKER),
        )
    ) {
        return undefined;
    }
    if (!Array.isArray(payload["messages"])) {
        return undefined;
    }
    const messages: unknown[] = payload["messages"];
    const first = messages.find((message) => record(message) && message["role"] === "user");
    if (!record(first)) {
        return undefined;
    }
    const content: unknown = first["content"];
    const block: unknown = Array.isArray(content)
        ? content.find(
              (item: unknown) =>
                  record(item) && item["type"] === "text" && typeof item["text"] === "string",
          )
        : undefined;
    const text = typeof content === "string" ? content : record(block) ? block["text"] : undefined;
    if (typeof text !== "string" || text === "") {
        return undefined;
    }
    const sampled = [4, 7, 20].map((index) => text[index] ?? "0").join("");
    const suffix = createHash("sha256")
        .update(`59cf53e54c78${sampled}${version}`)
        .digest("hex")
        .slice(0, 3);
    const cch = createHash("sha256").update(text).digest("hex").slice(0, 5);
    return {
        ...payload,
        system: [
            {
                type: "text",
                text: `${MARKER} cc_version=${version}.${suffix}; cc_entrypoint=sdk-cli; cch=${cch};`,
            },
            ...system,
        ],
    };
}

export default function subscription(host: Host) {
    const configured = process.env["PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION"]?.trim();
    const version = configured === undefined || configured === "" ? DEFAULT_VERSION : configured;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error("PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION must be X.Y.Z");
    }
    const state: Diagnostics = {
        version,
        source: configured === undefined || configured === "" ? "default" : "environment",
        transportVersion: null,
        learnedFloor: null,
        lastRetry: "none",
        versionError: null,
        last: null,
    };
    states.set(host, state);
    host.onDispose(() => {
        states.delete(host);
    });
    host.wrapModelFetch((next, model) =>
        oauthTransport(next, model, state, shapeRequest, {
            version,
            override: state.source === "environment",
        }),
    );
    return defineExtension({ name: host.name });
}
