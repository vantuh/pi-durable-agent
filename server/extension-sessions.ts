/**
 * What an extension may ask of one session through the host: the request its next turn would send, the entries that
 * request is built from, and the prompt an empty session would start with. Each opens the session and reads; none
 * writes an entry.
 */

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { EntryRecord, Harness } from "@earendil-works/pi-durable";

import { messageOf } from "../shared/guards.ts";
import { idOf } from "./conversation-id.ts";
import { executionEnv } from "./execution-env.ts";
import type { SessionPrompt, SessionRequest } from "./extensions/contract.ts";
import { createSessionRequest } from "./model-requests.ts";
import { sessionPromptOf } from "./session-prompt.ts";
import type { Sessions } from "./sessions.ts";

export type ExtensionSessions = {
    request: (session: number) => Promise<SessionRequest | undefined>;
    contextOf: (session: number) => Promise<readonly EntryRecord[] | undefined>;
    prompt: (session: number) => Promise<SessionPrompt | undefined>;
};

/**
 * Each dependency is read when a call is made, not when this is built: the extensions that call it load before the
 * sessions, the model runtime and the harness exist.
 */
export function extensionSessions(deps: {
    sessions: () => Sessions;
    runtime: () => ModelRuntime;
    harness: () => Harness;
}): ExtensionSessions {
    const { sessions, runtime, harness } = deps;

    /**
     * One conversation's next request, for an extension that reuses its cache, and one request on top: the
     * context the next request would send, and a request through the same model runtime, so the installed
     * fetch wrappers shape both. The request sends the messages it is given, the conversation's or its own.
     */
    async function request(session: number): Promise<SessionRequest | undefined> {
        const opened = await sessions().open(idOf(session));

        if (opened === undefined) {
            return undefined;
        }

        const agent = await opened.conversation.agent(context);
        const ref = agent.model;

        if (ref === undefined) {
            return undefined;
        }

        const model = runtime().getModel(ref.provider, ref.modelId);

        if (model === undefined) {
            return undefined;
        }

        const { messages } = await opened.conversation.context(context);

        return createSessionRequest(runtime(), model, messages, agent.thinkingLevel);
    }

    /** The entries one conversation's next request is built from: the newest head marker, then everything since. */
    async function contextOf(session: number): Promise<readonly EntryRecord[] | undefined> {
        const opened = await sessions().open(idOf(session));

        return opened === undefined
            ? undefined
            : (await opened.conversation.context(context)).entries;
    }

    /**
     * The system prompt and tools an empty session's first request will carry, rendered without writing an
     * entry or calling a model. Undefined once the session has entries.
     */
    async function prompt(session: number): Promise<SessionPrompt | undefined> {
        const opened = await sessions().open(idOf(session));

        if (opened === undefined) {
            return undefined;
        }

        return await sessionPromptOf({
            conversation: opened.conversation,
            models: runtime(),
            // The builder the Harness was opened with, so the sections see the same environment.
            env: executionEnv(process.cwd()),
            read: harness(),
            report: (error, what) => {
                console.log(`session prompt: "${what}" failed: ${messageOf(error)}`);
            },
            context,
        });
    }

    return { request, contextOf, prompt };
}
