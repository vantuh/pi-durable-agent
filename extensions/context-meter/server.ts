/**
 * How full the context is, under the composer: the last answer's tokens (prompt, cache,
 * and output: what the next request starts from) over the model's context window. Hovering it opens
 * what the context holds: system prompt sections and tools, with estimated sizes.
 */

import { defineExtension, type EntryRecord } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";
import type { Breakdown, Part } from "./refs.ts";

export const meta = {
    title: "Context meter",
    description: "Shows how full the context window is.",
};

// The model's own count of a prompt is not known before a request, so these are estimates.
const CHARS_PER_TOKEN = 3.5;
const PREVIEW = 160;

const views = new Map<number, readonly EntryRecord[]>();
let windowOf: Host["contextWindow"] = () => undefined;

const estimate = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** The text of a tagged section without its `<key>` wrapper, on one line. */
function previewOf(key: string, text: string): string {
    const inner = text.startsWith(`<${key}>`)
        ? text.slice(key.length + 2, -(key.length + 3))
        : text;

    return inner.trim().replace(/\s+/g, " ").slice(0, PREVIEW);
}

/** Replays the system entries in order, as the harness does: sections set or removed, tools added or removed. */
function promptOf(entries: readonly EntryRecord[]): { sections: Part[]; tools: Part[] } {
    const sections = new Map<string, string>();
    const tools = new Map<string, { description: string; tokens: number }>();

    for (const entry of entries) {
        const message = entry.kind === "pi.system" ? entry.model?.[0] : undefined;

        if (message?.role !== "system") {
            continue;
        }

        for (const [key, text] of Object.entries(message.sections ?? {})) {
            if (text === null) {
                sections.delete(key);
            } else {
                sections.set(key, text);
            }
        }

        for (const tool of message.toolsRemoved ?? []) {
            tools.delete(tool.name);
        }

        for (const tool of message.toolsAdded ?? []) {
            tools.set(tool.name, {
                description: tool.description,
                tokens: estimate(JSON.stringify(tool)),
            });
        }
    }

    return {
        sections: [...sections].map(([name, text]) => ({
            name,
            preview: previewOf(name, text),
            tokens: estimate(text),
        })),
        tools: [...tools].map(([name, tool]) => ({
            name,
            preview: tool.description.trim().replace(/\s+/g, " ").slice(0, PREVIEW),
            tokens: tool.tokens,
        })),
    };
}

/**
 * How many real tokens one estimated token is, for this model: the first answer's prompt size over
 * what the same prompt estimates to. Undefined when that answer came after anything but system and
 * user text (images, tool results), where the estimate has nothing honest to compare with.
 */
function scaleOf(entries: readonly EntryRecord[]): number | undefined {
    const index = entries.findIndex((entry) => entry.kind === "pi.assistant");
    const answer = entries[index]?.model?.[0];
    const before = entries.slice(0, index);

    if (answer?.role !== "assistant" || answer.stopReason === "error") {
        return undefined;
    }

    const prompt = promptOf(before);
    let estimated = [...prompt.sections, ...prompt.tools].reduce(
        (sum, part) => sum + part.tokens,
        0,
    );

    for (const entry of before) {
        const message = entry.model?.[0];

        if (entry.kind === "pi.system") {
            continue;
        }

        if (entry.kind !== "pi.user" || message?.role !== "user") {
            return undefined;
        }

        if (typeof message.content === "string") {
            estimated += estimate(message.content);
        } else if (message.content.every((block) => block.type === "text")) {
            estimated += estimate(message.content.map((block) => block.text).join(""));
        } else {
            return undefined;
        }
    }

    const { input, cacheRead, cacheWrite } = answer.usage;
    const actual = input + cacheRead + cacheWrite;

    return estimated > 0 && actual > 0 ? actual / estimated : undefined;
}

export default function contextMeter(host: Host) {
    windowOf = host.contextWindow;
    host.onDispose(() => {
        views.clear();
    });
    host.onCommit((view) => {
        views.set(view.session.id, view.entries);
    });

    return defineExtension({ name: host.name });
}

export const actions: Record<string, Action> = {
    breakdown({ session }): Breakdown | null {
        const entries = session === null ? undefined : views.get(session.id);
        const last = entries?.findLast((entry) => entry.kind === "pi.assistant")?.model?.[0];

        if (entries === undefined || last?.role !== "assistant") {
            return null;
        }

        const { input, output, cacheRead, cacheWrite } = last.usage;
        const scale = scaleOf(entries);
        const { sections, tools } = promptOf(entries);
        const scaled = (part: Part): Part => ({
            ...part,
            tokens: Math.round(part.tokens * (scale ?? 1)),
        });

        return {
            model: `${last.provider}/${last.model}`,
            used: input + output + cacheRead + cacheWrite,
            window: windowOf(last.provider, last.model) ?? 0,
            calibrated: scale !== undefined,
            sections: sections.map(scaled),
            tools: tools.map(scaled),
        };
    },
};
