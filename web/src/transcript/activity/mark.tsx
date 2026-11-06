import {
    Folder,
    FilePlus,
    FileText,
    Lightbulb,
    type LucideIcon,
    Minus,
    Pencil,
    Search,
    Sparkle,
    Terminal,
    Wrench,
    X,
} from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import type { FolderToolIcon } from "@/extensions.ts";
import type { StepStatus } from "@/lib/turns.ts";
import { cn } from "@/lib/utils";

const MARK_TONES = {
    thought: "bg-spark/15 text-spark",
    pending: "bg-accent/15 text-accent",
    running: "bg-accent/15 text-accent",
    done: "bg-ok/15 text-ok",
    error: "bg-danger/15 text-danger",
    stopped: "bg-raised text-faint",
} as const;

/** Once done, these wear the warn tone instead of the done one: the eye catches a call that changed a file. */
const WARN_TOOLS = new Set(["write", "edit", "skill"]);

/** What kind of core call a step is, as its mark's icon: the tone says how it went. Extensions bring their own. */
const TOOL_ICONS: Record<string, LucideIcon> = {
    bash: Terminal,
    read: FileText,
    edit: Pencil,
    write: FilePlus,
    grep: Search,
    find: Search,
    ls: Folder,
    skill: Lightbulb,
};

/** How a step went, in a circle on the timeline's rule; the canvas ring cuts the rule around it. */
export function Mark({
    tone,
    tool,
    icons,
}: {
    tone: StepStatus | "thought";
    tool?: string;
    icons?: readonly FolderToolIcon[];
}) {
    // While it runs, and when it failed or never ran, the mark says how it stands, as Pi Pocket's does; once done, what
    // kind of call it was.
    const Icon =
        tone === "thought"
            ? Sparkle
            : tone === "error"
              ? X
              : tone === "stopped"
                ? Minus
                : (TOOL_ICONS[tool ?? ""] ??
                  icons?.find((each) => each.id === tool)?.icon ??
                  Wrench);
    const label =
        tone === "error"
            ? "Failed"
            : tone === "stopped"
              ? "Did not run"
              : tone === "done"
                ? "Done"
                : undefined;

    return (
        <span className="bg-canvas ring-canvas relative shrink-0 ring-3">
            {/* Not a step: 19px is what puts this mark's centre on the timeline rule, 13px in at 22.5. */}
            <span
                {...(label === undefined ? {} : { "aria-label": label, role: "img" })}
                className={cn(
                    "grid size-[19px] place-items-center",
                    tone === "done" && tool !== undefined && WARN_TOOLS.has(tool)
                        ? "bg-warn/15 text-warn"
                        : MARK_TONES[tone],
                )}
            >
                {tone === "pending" || tone === "running" ? (
                    <Spinner className="size-2.5" />
                ) : (
                    <Icon aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
                )}
            </span>
        </span>
    );
}
