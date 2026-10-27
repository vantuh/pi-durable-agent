/** Adapted from the Pi extension `auto-session-name`: automatic runs preserve names; the menu regenerates. */
import { randomUUID } from "node:crypto";

import {
    type Api,
    type AssistantMessage,
    getSupportedThinkingLevels,
    type Model,
    type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { defineExtension } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host } from "../../server/sdk.ts";
import { buildTitleTranscript, parseGeneratedSessionTitle } from "./lib.ts";
import { readAuto, writeAuto } from "./store.ts";

export const meta = {
    title: "Session names",
    description: "Names a conversation from what it was about, after a run or from its menu.",
};

const TITLE_TIMEOUT_MS = 90_000;
/** A reasoning model shares this budget between thinking and the title. */
const TITLE_MAX_TOKENS = 512;

const TITLE_SYSTEM_PROMPT = "You name chat sessions from a transcript. Reply with the title only.";

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

// Use the cheapest level. Gemini's SDK emits unsupported "minimal" when thinking is off,
// so Gemini needs the next supported level instead.
function resolveTitleThinkingLevel(model: Model<Api>): ModelThinkingLevel {
    if (!model.reasoning) {
        return "off";
    }
    // getSupportedThinkingLevels lists levels in ascending cost order.
    const supported = getSupportedThinkingLevels(model);
    const rejectsMinimal = model.api === "google-generative-ai" || /gemini/i.test(model.id);
    const usable = rejectsMinimal
        ? supported.filter((level) => level !== "off" && level !== "minimal")
        : supported;
    return usable[0] ?? supported[0] ?? "off";
}

function titleFromAssistant(message: AssistantMessage): string {
    if (message.stopReason === "error") {
        throw new Error(message.errorMessage ?? "The title model request failed");
    }
    if (message.stopReason === "aborted") {
        throw new Error("Session title generation timed out");
    }

    const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    if (!text) {
        throw new Error("The model did not return a session title");
    }
    return parseGeneratedSessionTitle(text);
}

/** Asks the session model for a title, or throws: there is no fallback name. */
async function generateTitle(host: Host, session: number): Promise<string> {
    const request = await host.sessionRequest(session);
    if (request === undefined) {
        throw new Error("The session has no model to name it with");
    }

    const transcript = buildTitleTranscript(request.messages);
    if (!transcript.trim()) {
        throw new Error("The session has no usable text to name");
    }

    const thinking = resolveTitleThinkingLevel(request.model);

    const signal = AbortSignal.timeout(TITLE_TIMEOUT_MS);
    try {
        const answer = await request.send(
            [
                {
                    role: "user",
                    content: [{ type: "text", text: `${transcript}\n\n${TITLE_PROMPT}` }],
                    timestamp: Date.now(),
                },
            ],
            signal,
            {
                systemPrompt: TITLE_SYSTEM_PROMPT,
                maxTokens: TITLE_MAX_TOKENS,
                // Too small and too unique to reuse the session's prefix or to write a
                // cache nobody will read.
                cacheRetention: "none",
                sessionId: randomUUID(),
                reasoning: thinking,
            },
        );
        return titleFromAssistant(answer);
    } catch (error) {
        if (signal.aborted) {
            throw new Error("Session title generation timed out", { cause: error });
        }
        throw error;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The live instance: whether automatic naming is on, and who is naming now. A reload starts from the file. */
let auto = false;
const naming = new Set<number>();
const settled = new Map<number, boolean>();

/**
 * Names a session the run just ended for, unless it has a name already. A name that lands while the
 * title is generated wins, because only a session still unnamed is named.
 */
async function autoName(host: Host, session: number): Promise<void> {
    if (!auto || naming.has(session)) {
        return;
    }
    if ((await host.sessionName(session)) !== null) {
        return;
    }

    naming.add(session);
    try {
        const title = await generateTitle(host, session);
        if ((await host.sessionName(session)) !== null) {
            return;
        }
        await host.setSessionTitle(session, title);
    } catch {
        // An unnamed session is better than a misleading name. The next settle tries again,
        // so a transient model failure heals on its own.
    } finally {
        naming.delete(session);
    }
}

export default async function autoSessionName(host: Host) {
    auto = await readAuto(host.dataDir);
    settled.clear();

    host.onCommit(async (view) => {
        const before = settled.get(view.session.id) === true;
        settled.set(view.session.id, view.busy);
        // A run ending, not every commit: a session's first commit arrives with no run behind it.
        if (!before || view.busy) {
            return;
        }
        await autoName(host, view.session.id);
    });

    return defineExtension({ name: host.name });
}

export const actions = (host: Host): Record<string, Action> => {
    const settingsOf = (): { auto: boolean } => ({ auto });

    return {
        settings: settingsOf,
        setAuto: async ({ args }) => {
            const on =
                typeof args === "object" && args !== null ? Reflect.get(args, "auto") : undefined;

            if (typeof on !== "boolean") {
                throw new ActionError("args must be { auto: boolean }");
            }

            await writeAuto(host.dataDir, on);
            auto = on;

            return settingsOf();
        },
        generate: async ({ session }) => {
            if (session === null) {
                throw new ActionError("a session is needed to name it");
            }

            const nameBefore = await host.sessionName(session.id);
            try {
                const title = await generateTitle(host, session.id);
                // The explicit call overrides the name it started from, never one that landed
                // while it was generating.
                if ((await host.sessionName(session.id)) !== nameBefore) {
                    throw new Error(
                        "The session name changed while the title was generated; keeping the newer name",
                    );
                }
                await host.setSessionTitle(session.id, title);

                return { title };
            } catch (error) {
                throw new ActionError(errorMessage(error));
            }
        },
    };
};
