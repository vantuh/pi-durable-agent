import type { ExtensionDetailsProps } from "@/sdk/types.ts";
import { DetailsColumn, DetailsNote } from "@/ui/details.tsx";

import { ProfileModels } from "./web/profile-models.tsx";

export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    if (!enabled || !installed) {
        return <DetailsNote>Turn Subagents on to change the model of a profile.</DetailsNote>;
    }

    return (
        <DetailsColumn>
            <p className="text-faint">
                The model is written into the profile&apos;s Markdown, so the next agent_spawn uses
                it. An agent already running keeps the model it started with.
            </p>
            <ProfileModels />
        </DetailsColumn>
    );
}
