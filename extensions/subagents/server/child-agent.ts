import type { Context } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AgentChange, ToolExecutionApi } from "@earendil-works/pi-durable";

import type { Profile } from "./profiles.ts";
import { PROTOCOL } from "./prompt.ts";

/** This extension's tools; an agent keeps the extension for its prompt wraps, not for these. */
const OWN_TOOLS = new Set(["agent_spawn", "agent_send", "agent_stop", "agent_status"]);

/** The model, thinking, tools and instructions of a profile, over the parent's agent the child copies. */
export async function childAgent(
    api: ToolExecutionApi,
    profile: Profile,
    context: Context,
): Promise<{ change: AgentChange } | { error: string }> {
    if (profile.model === undefined) {
        return {
            error: `Profile "${profile.name}": model is required in its Markdown frontmatter.`,
        };
    }

    if (profile.invalidTools !== undefined) {
        return {
            error: `Profile "${profile.name}": tools must be a list of names, got ${JSON.stringify(profile.invalidTools)}.`,
        };
    }

    const [provider = "", modelId = ""] = profile.model.split(/\/(.*)/s);

    if (provider === "" || modelId === "") {
        return {
            error: `Profile "${profile.name}": model must be an exact provider/modelId, got "${profile.model}".`,
        };
    }

    const available = await api.models.getAvailable(provider);
    const model = available.find((each) => each.id === modelId);

    if (model === undefined) {
        return {
            error: `Profile "${profile.name}": model "${profile.model}" is not available here. Available for ${provider}: ${available.map((each) => each.id).join(", ") || "none (check provider registration and authentication)"}.`,
        };
    }

    const supported = getSupportedThinkingLevels(model);
    const requested = profile.thinking === undefined ? "off" : profile.thinking;
    const thinkingLevel = supported.find((each) => each === requested);

    if (thinkingLevel === undefined) {
        return {
            error: `Profile "${profile.name}": thinking ${JSON.stringify(requested)} is not supported by ${profile.model}. Supported: ${supported.join(", ")}.`,
        };
    }

    const parent = await api.agent(context);
    const wanted = new Set(profile.tools);
    const own = parent.tools.filter((tool) => OWN_TOOLS.has(tool.name));
    const tools = parent.tools.filter((tool) => wanted.has(tool.name) && !OWN_TOOLS.has(tool.name));

    return {
        change: {
            instructions: `${profile.instructions}\n\n${PROTOCOL}`.trim(),
            model: { provider: model.provider, modelId: model.id },
            thinkingLevel,
            tools: profile.tools === undefined ? { remove: own } : tools,
        },
    };
}
