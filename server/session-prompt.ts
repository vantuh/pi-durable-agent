/**
 * The sections and tools an empty conversation's first request would carry, rendered the way pi-durable's
 * generation `prepare` phase renders them, without writing an entry or calling a model. Anything already in
 * the transcript means the prompt is not the whole context, so this answers nothing then.
 *
 * The rules are copied from internals that are not exported; `test/session-prompt.test.ts` holds them
 * against the prompt a real first run commits. It is the harness's view of the request, not a provider
 * payload: what a fetch wrapper adds is not here.
 */

import type { Context } from "@earendil-works/chord/context";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import type {
    Agent,
    Conversation,
    DocumentReader,
    HarnessOptions,
    PromptInput,
    ToolRegistration,
} from "@earendil-works/pi-durable";

import type { SessionPrompt } from "./extensions/contract.ts";
import type { ModelCatalog } from "./sessions.ts";

// shortcut: follows pi-durable 1.5.0 internals; replace when a public prompt-preview API exists.
/**
 * The agent's sections as the first request would send them: rendered in order, tagged unless the section
 * asked not to be, an `undefined` section left out, and a throw reported and left out too.
 */
async function rendered(
    agent: Agent,
    input: PromptInput,
    report: (error: unknown, what: string) => void,
    context: Context,
): Promise<{ key: string; text: string }[]> {
    const sections: { key: string; text: string }[] = [];

    for (const section of agent.sections) {
        let text: string | undefined;

        try {
            text = await section.render(input, context);
        } catch (error) {
            // An aborted request is the caller's own, as generation treats it.
            if (context.abortSignal?.aborted === true) {
                throw error;
            }

            report(error, section.key);
            continue;
        }

        if (text === undefined) {
            continue;
        }

        sections.push({
            key: section.key,
            text: section.tag === false ? text : `<${section.key}>\n${text}\n</${section.key}>`,
        });
    }

    return sections;
}

/** The system prompt and tools an empty conversation's first request would offer, its model included. */
export async function sessionPromptOf(options: {
    conversation: Conversation;
    models: ModelCatalog;
    /** The environment builder the Harness was opened with: sections read it, as they do in a request. */
    env: NonNullable<HarnessOptions<ToolRegistration>["env"]>;
    /** Committed document reads, as `PromptInput.read`. */
    read: DocumentReader;
    report: (error: unknown, what: string) => void;
    context: Context;
}): Promise<SessionPrompt | undefined> {
    const { conversation, context } = options;

    if ((await conversation.context(context)).entries.length > 0) {
        return undefined;
    }

    const agent = await conversation.agent(context);
    const ref = agent.model;
    const model =
        ref === undefined ? undefined : options.models.getModel(ref.provider, ref.modelId);

    if (model === undefined) {
        return undefined;
    }

    // A builder that throws leaves the request without an environment, as generation leaves it.
    let env: PromptInput["env"];

    try {
        env = await options.env(
            {
                conversationId: conversation.id,
                ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
                read: options.read,
            },
            context,
        );
    } catch (error) {
        if (context.abortSignal?.aborted === true) {
            throw error;
        }

        options.report(error, "env");
    }

    return {
        model,
        sections: await rendered(
            agent,
            { conversationId: conversation.id, agent, env, shown: {}, read: options.read },
            options.report,
            context,
        ),
        tools: agent.tools.map(toToolDeclaration),
    };
}
