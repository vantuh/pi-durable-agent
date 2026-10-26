import { GitBranch } from "lucide-react";

import type { ClientStatus, ClientUsage } from "../../../shared/protocol.ts";

type Props = {
    connected: boolean;
    cwd: string;
    home: string;
    branch: string | null;
    usage: ClientUsage;
    status: ClientStatus[];
    busy: boolean;
    issue: string | null;
};

function toneOf(status: "ok" | "warn" | "danger"): string {
    if (status === "danger") {
        return "bg-danger";
    }

    if (status === "warn") {
        return "bg-warn";
    }

    return "bg-ok";
}

/** `~/name` for a folder directly in home, `../name` for any other; the full path is the tooltip. */
function shortPath(cwd: string, home: string): string {
    const parts = cwd.split("/").filter((part) => part !== "");
    const name = parts[parts.length - 1];

    if (name === undefined) {
        return cwd;
    }

    return cwd === `${home}/${name}` ? `~/${name}` : `../${name}`;
}

function money(cost: number): string {
    return cost === 0 ? "$0" : `$${cost.toFixed(3)}`;
}

export function StatusBar({ connected, cwd, home, branch, usage, status, busy, issue }: Props) {
    const tone = issue === null ? (busy ? "warn" : connected ? "ok" : "danger") : "danger";
    const label = issue ?? (busy ? "working" : connected ? "ready" : "offline");

    return (
        <footer className="rounded-card border-edge-soft bg-canvas text-meta text-muted flex h-8 shrink-0 items-center gap-3 overflow-hidden border px-3">
            <span className="flex shrink-0 items-center gap-1.5">
                <span className={`size-2 rounded-full ${toneOf(tone)}`} />
                <span className={tone === "danger" ? "text-danger" : "text-ink"}>{label}</span>
            </span>

            <span title={cwd} className="text-faint hidden min-w-0 truncate font-mono sm:inline">
                {shortPath(cwd, home)}
            </span>

            {branch === null ? null : (
                <span className="text-faint hidden shrink-0 items-center gap-1 font-mono sm:flex">
                    <GitBranch className="size-3" />
                    {branch}
                </span>
            )}

            {status.map((field, at) => (
                <span
                    key={field.source}
                    title={field.title}
                    className={`text-faint shrink-0 font-mono ${at === 0 ? "ml-auto" : ""}`}
                >
                    {field.text}
                </span>
            ))}
            <span
                className={`text-faint shrink-0 font-mono ${status.length === 0 ? "ml-auto" : ""}`}
            >
                ↑{usage.input} ↓{usage.output} · {money(usage.cost)}
            </span>
        </footer>
    );
}
