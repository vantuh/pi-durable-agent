/**
 * How full the context is, under the composer: the last answer's tokens (prompt, cache,
 * and output: what the next request starts from) over the model's context window. Hovering it opens
 * what the context holds: system prompt sections and tools, with estimated sizes. Before a session's
 * first request it holds what that request will carry, estimated, and says so.
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

let contextOf: Host["sessionContext"] = () => Promise.resolve(undefined);
let windowOf: Host["contextWindow"] = () => undefined;
let ownerOf: Host["toolOwner"] = () => undefined;
let renderPrompt: Host["sessionPrompt"] = () => Promise.resolve(undefined);

const estimate = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Whether the provider counted this answer's usage: pi-ai fills it as the stream speaks, so one that
 * failed or was stopped before its stream started carries only zeros.
 */
function counted(entry: EntryRecord | undefined): boolean {
    const message = entry?.model?.[0];

    if (message?.role !== "assistant") {
        return false;
    }

    const { input, output, cacheRead, cacheWrite } = message.usage;

    return input + output + cacheRead + cacheWrite > 0;
}

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
 * One row per extension that put two or more tools in the prompt, named after it, holding its tools;
 * a lone tool and a tool the core installed keep a row of their own. A group sits where its first
 * tool did.
 */
function groupTools(tools: readonly Part[], owner: Host["toolOwner"]): Part[] {
    const children = new Map<string, Part[]>();

    for (const tool of tools) {
        const name = owner(tool.name);

        if (name !== undefined) {
            children.set(name, [...(children.get(name) ?? []), tool]);
        }
    }

    const rows: Part[] = [];
    const shown = new Set<string>();

    for (const tool of tools) {
        const name = owner(tool.name);
        const group = name === undefined ? undefined : children.get(name);

        if (name === undefined || group === undefined || group.length < 2) {
            rows.push(tool);
            continue;
        }

        if (!shown.has(name)) {
            shown.add(name);
            rows.push({
                name,
                preview: group.map((child) => child.name).join(", "),
                tokens: group.reduce((sum, child) => sum + child.tokens, 0),
                parts: group,
            });
        }
    }

    return rows;
}

/**
 * How many real tokens one estimated token is, for this model: the first answer's prompt size over
 * what the same prompt estimates to. Undefined when that answer came after anything but system and
 * user text (images, tool results), where the estimate has nothing honest to compare with.
 */
function scaleOf(entries: readonly EntryRecord[]): number | undefined {
    const index = entries.findIndex((entry) => entry.kind === "pi.assistant");
    const first = entries[index];
    const answer = first?.model?.[0];
    const before = entries.slice(0, index);

    if (!counted(first) || answer?.role !== "assistant") {
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
    ownerOf = host.toolOwner;
    renderPrompt = host.sessionPrompt;
    contextOf = host.sessionContext;

    return defineExtension({ name: host.name });
}

/**
 * What the first request of a session with nothing in it will carry, estimated from the prompt's own text:
 * no answer has priced it, so `used` is the sum of the parts rather than a count the model gave. The
 * session's first question adds to it, and then the request prices the whole thing.
 */
async function initialOf(session: number): Promise<Breakdown | null> {
    const prompt = await renderPrompt(session);

    if (prompt === undefined) {
        return null;
    }

    const sections = prompt.sections.map(({ key, text }) => ({
        name: key,
        preview: previewOf(key, text),
        tokens: estimate(text),
    }));
    const tools = prompt.tools.map((tool) => ({
        name: tool.name,
        preview: tool.description.trim().replace(/\s+/g, " ").slice(0, PREVIEW),
        tokens: estimate(JSON.stringify(tool)),
    }));

    return {
        model: `${prompt.model.provider}/${prompt.model.id}`,
        used: [...sections, ...tools].reduce((sum, part) => sum + part.tokens, 0),
        window: prompt.model.contextWindow,
        calibrated: false,
        estimate: true,
        sections,
        tools: groupTools(tools, ownerOf),
    };
}

export const actions: Record<string, Action> = {
    async breakdown({ session }): Promise<Breakdown | null> {
        // Not a commit's `entries`, which is a window of the newest 50 to 100: the rows replay the system
        // entries from the start and calibrate on the first answer.
        const entries = session === null ? undefined : await contextOf(session.id);

        if (session !== null && entries?.length === 0) {
            return await initialOf(session.id);
        }

        const last = entries?.findLast((entry) => entry.kind === "pi.assistant" && counted(entry))
            ?.model?.[0];

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
            estimate: false,
            sections: sections.map(scaled),
            tools: groupTools(tools.map(scaled), ownerOf),
        };
    },
};
