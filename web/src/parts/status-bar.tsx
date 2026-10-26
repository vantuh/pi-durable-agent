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

const FILL_TONE = { warn: "bg-warn", danger: "bg-danger" };

function Field({ field }: { field: ClientStatus }) {
    return (
        <span
            title={field.title}
            className={`text-faint shrink-0 items-center gap-1.5 font-mono ${field.slot === "center" ? "flex" : "hidden sm:flex"}`}
        >
            {field.label === undefined ? null : (
                <span className="hidden sm:inline">{field.label}</span>
            )}
            {field.meter === undefined ? null : (
                <span className="bg-raised flex h-1 w-9 overflow-hidden rounded-full">
                    <span
                        className={
                            field.meter.tone === undefined
                                ? "bg-accent"
                                : FILL_TONE[field.meter.tone]
                        }
                        style={{ width: `${String(Math.round(field.meter.fill * 100))}%` }}
                    />
                </span>
            )}
            {field.text}
        </span>
    );
}

/** 394, 1.2k, 10.9k, 250k, 1.5M: one decimal while it still says something. */
function compact(count: number): string {
    const trim = (value: number): string => value.toFixed(1).replace(/\.0$/, "");

    if (count >= 1_000_000) {
        return `${trim(count / 1_000_000)}M`;
    }

    if (count >= 100_000) {
        return `${String(Math.round(count / 1000))}k`;
    }

    return count >= 1000 ? `${trim(count / 1000)}k` : String(count);
}

function money(cost: number): string {
    return cost === 0 ? "$0" : `$${cost.toFixed(3)}`;
}

export function StatusBar({ connected, cwd, home, branch, usage, status, busy, issue }: Props) {
    const tone = issue === null ? (busy ? "warn" : connected ? "ok" : "danger") : "danger";
    const label = issue ?? (busy ? "working" : connected ? "ready" : "offline");
    const at = (slot: ClientStatus["slot"]) => status.filter((field) => field.slot === slot);

    return (
        <footer className="rounded-card border-edge-soft bg-canvas text-meta text-muted grid h-8 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 overflow-hidden border px-3">
            <div className="flex min-w-0 items-center gap-3">
                <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`size-2 rounded-full ${toneOf(tone)}`} />
                    <span className={tone === "danger" ? "text-danger" : "text-ink"}>{label}</span>
                </span>

                <span
                    title={cwd}
                    className="text-faint hidden min-w-0 truncate font-mono sm:inline"
                >
                    {shortPath(cwd, home)}
                </span>

                {branch === null ? null : (
                    <span className="text-faint hidden shrink-0 items-center gap-1 font-mono sm:flex">
                        <GitBranch className="size-3" />
                        {branch}
                    </span>
                )}

                {at("start").map((field) => (
                    <Field key={field.source} field={field} />
                ))}
            </div>

            <div className="flex items-center gap-3">
                {at("center").map((field) => (
                    <Field key={field.source} field={field} />
                ))}
            </div>

            <div className="flex min-w-0 items-center justify-end gap-3">
                {at("end").map((field) => (
                    <Field key={field.source} field={field} />
                ))}
                <span
                    title={`${String(usage.input)} tokens in, ${String(usage.output)} out`}
                    className="text-faint shrink-0 font-mono"
                >
                    ↑{compact(usage.input)} ↓{compact(usage.output)} · {money(usage.cost)}
                </span>
            </div>
        </footer>
    );
}
