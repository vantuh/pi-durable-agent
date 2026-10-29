import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { ProfileModels } from "./profile-models.tsx";

export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    if (!enabled || !installed) {
        return (
            <p className="text-faint text-meta">
                Turn Subagents on to change the model of a profile.
            </p>
        );
    }

    return (
        <div className="text-meta flex flex-col gap-2">
            <p className="text-faint">
                The model is written into the profile&apos;s Markdown, so the next agent_spawn uses
                it. An agent already running keeps the model it started with.
            </p>
            <ProfileModels />
        </div>
    );
}
