import type { AssistantMessage } from "@earendil-works/pi-ai";

import type { Host } from "../../../server/sdk.ts";
import type { StripAgent } from "../refs.ts";
import { readProfiles } from "./profiles.ts";

/**
 * What the strip needs of a conversation something else started, as of its latest commit. The
 * parent is the core's owner link; a commit is the only source of the rest. Its name and profile
 * are not here: the parent's `AgentsDoc` keeps them.
 */
export type Seen = {
    owner: number;
    cwd: string | null;
    answer: AssistantMessage | undefined;
};

export const seen = new Map<number, Seen>();

/** The parent's record of an agent: its name and its profile. */
export type Named = { name: string; profile: string };

export async function stripAgent(
    host: Host,
    id: number,
    child: Seen,
    named: Named | undefined,
    parentCwd: string,
): Promise<StripAgent> {
    const { answer, cwd } = child;
    const profile = named?.profile ?? "";
    const used =
        answer === undefined
            ? 0
            : answer.usage.input +
              answer.usage.output +
              answer.usage.cacheRead +
              answer.usage.cacheWrite;
    const window =
        answer === undefined ? 0 : (host.contextWindow(answer.provider, answer.model) ?? 0);
    // Before its first answer the profile is the only place that names the model; spawn read it
    // from the parent's folder, whatever folder the agent works in.
    const model =
        answer === undefined
            ? ((await readProfiles(parentCwd)).get(profile)?.model ?? "")
            : `${answer.provider}/${answer.model}`;

    return {
        name: named?.name ?? "Agent",
        profile,
        model,
        session: id,
        fill: window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0,
        used,
        window,
        cwd: cwd ?? null,
    };
}
