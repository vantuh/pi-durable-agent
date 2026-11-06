import { Badge } from "@/components/ui/badge.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { shortModel, tokens } from "@/lib/format.ts";
import { isPlainClick } from "@/lib/route.ts";

import type { StripAgent } from "../refs.ts";
import { ROW } from "./strip-row.ts";

const WARN_ABOVE = 70;

function hover(agent: StripAgent): string {
    const context =
        agent.window > 0
            ? `${tokens(agent.used)} / ${tokens(agent.window)} (${String(agent.fill)}%)`
            : "none yet";

    const folder = agent.cwd === null ? "" : ` Folder: ${agent.cwd}.`;

    return `${[agent.name, agent.profile, agent.model].filter((part) => part !== "").join(" · ")}. Context estimate: ${context}.${folder}`;
}

// "/repo/", "/repo/." and "/repo" are one folder; the root stays "/".
function trimmed(folder: string | null): string | null {
    return folder === null ? null : folder.replace(/(?<=.)(?:\/\.|\/)+$/, "");
}

export function Chip({
    agent,
    href,
    onOpen,
    folder,
}: {
    agent: StripAgent;
    href: string;
    onOpen: () => void;
    folder: string | null;
}) {
    // Shown only when the agent works somewhere other than the open session, so the usual chip is unchanged.
    const elsewhere = agent.cwd !== null && trimmed(agent.cwd) !== trimmed(folder);

    return (
        <Badge
            asChild
            className={`${ROW} border-edge-soft bg-panel hover:border-agent focus-visible:ring-accent gap-2 py-1 font-sans no-underline outline-none focus-visible:ring-2`}
        >
            <a
                href={href}
                title={hover(agent)}
                aria-label={`Open ${agent.name}'s conversation`}
                onClick={(event) => {
                    if (isPlainClick(event)) {
                        event.preventDefault();
                        onOpen();
                    }
                }}
            >
                <span className="state-mark working text-warn" aria-hidden />
                <span className="text-ink text-meta max-w-30 truncate">{agent.name}</span>
                {agent.model === "" ? null : (
                    <span className="text-faint text-meta max-w-21 truncate">
                        {shortModel(agent.model)}
                    </span>
                )}
                {/* Not a step: 70px holds a folder's last segment, and keeps it shorter than the name beside it. */}
                {elsewhere ? (
                    <span
                        className="text-faint bg-raised border-edge-soft text-meta hidden max-w-[70px] truncate border px-1 sm:inline"
                        aria-hidden
                    >
                        {agent.cwd
                            ?.split("/")
                            .filter((part) => part !== "")
                            .at(-1) ?? agent.cwd}
                    </span>
                ) : null}
                <span className="text-faint text-meta flex items-center gap-1.5 font-mono">
                    {agent.window > 0 ? (
                        <>
                            <Progress
                                value={agent.fill}
                                tone={agent.fill > WARN_ABOVE ? "warn" : "accent"}
                                className="w-7"
                                aria-label={`${agent.name} context`}
                            />
                            {`${String(agent.fill)}%`}
                        </>
                    ) : (
                        "—"
                    )}
                </span>
            </a>
        </Badge>
    );
}
