import {
    Braces,
    Container,
    Copy,
    CornerDownRight,
    Equal,
    FilePlus,
    FileText,
    Folder,
    FolderOpen,
    FolderPlus,
    GitBranch,
    Globe,
    LogOut,
    type LucideIcon,
    MessageSquare,
    MoveRight,
    Package,
    Play,
    Search,
    Terminal,
    Timer,
    Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PANE } from "@/ui/pane.tsx";

import { CommandCode } from "./command-code.tsx";
import { bare, JOINS, program, redirectLabel } from "./describe.ts";
import type { Part } from "./layout.ts";

type Look = { icon: LucideIcon; tone: string };

/** One kind of program: every name in it wears the kind's colour, written out whole so Tailwind finds it. */
function kind(tone: string, icons: Readonly<Record<string, LucideIcon>>): Record<string, Look> {
    return Object.fromEntries(Object.entries(icons).map(([name, icon]) => [name, { icon, tone }]));
}

/** What kind of program a row runs; one not listed wears the terminal. */
const LOOKS: Readonly<Record<string, Look>> = {
    ...kind("text-command-git", { git: GitBranch, gh: GitBranch }),
    ...kind("text-command-package", {
        pnpm: Package,
        npm: Package,
        npx: Package,
        yarn: Package,
        bun: Package,
    }),
    ...kind("text-command-run", { node: Play, python: Play, python3: Play, docker: Container }),
    ...kind("text-command-files", {
        cd: FolderOpen,
        ls: Folder,
        tree: Folder,
        mkdir: FolderPlus,
        touch: FilePlus,
        cp: Copy,
        mv: MoveRight,
    }),
    ...kind("text-command-read", {
        cat: FileText,
        head: FileText,
        tail: FileText,
        less: FileText,
        sed: FileText,
        awk: FileText,
        wc: FileText,
        jq: Braces,
    }),
    ...kind("text-command-search", { grep: Search, rg: Search, find: Search, fd: Search }),
    ...kind("text-command-network", { curl: Globe, wget: Globe }),
    ...kind("text-danger", { rm: Trash2, rmdir: Trash2 }),
    ...kind("text-faint", {
        echo: MessageSquare,
        printf: MessageSquare,
        sleep: Timer,
        exit: LogOut,
    }),
};

const PLAIN: Look = { icon: Terminal, tone: "text-faint" };
const ASSIGNMENT: Look = { icon: Equal, tone: "text-faint" };

/** Tailwind needs whole class names; a part deeper than the last level stays at it. */
const DEPTHS = ["", "ml-5", "ml-10", "ml-15"] as const;

function depthClass(depth: number): string {
    return DEPTHS[Math.min(depth, DEPTHS.length - 1)] ?? "";
}

/**
 * A laid-out command in one frame, a row per command: the kind of program it runs as an icon, its redirects as badges,
 * and between two rows what joins them.
 */
export function Panels({ source, parts }: { source: string; parts: readonly Part[] }) {
    return (
        <div className={cn(PANE, "bg-sunken flex min-w-0 flex-col gap-1 px-3 py-2.5")}>
            {parts.map((part, index) => {
                if (part.kind === "blank") {
                    return null;
                }

                if (part.kind === "comment") {
                    return (
                        // oxlint-disable-next-line react/no-array-index-key -- rows of one command have no id; their order is the identity
                        <p key={index} className="text-meta text-faint font-mono">
                            {part.text}
                        </p>
                    );
                }

                if (part.kind === "code") {
                    return (
                        <pre
                            // oxlint-disable-next-line react/no-array-index-key -- likewise
                            key={index}
                            className="text-code text-ink font-mono break-all whitespace-pre-wrap"
                        >
                            <code>
                                <CommandCode command={part.text} />
                            </code>
                        </pre>
                    );
                }

                const name = part.head === undefined ? undefined : program(part.head);
                const assignment = part.command !== undefined && part.command.name === undefined;
                const look = assignment
                    ? ASSIGNMENT
                    : ((name === undefined ? undefined : LOOKS[name]) ?? PLAIN);
                const Icon = look.icon;
                const next = parts[index + 1];

                return (
                    // oxlint-disable-next-line react/no-array-index-key -- likewise
                    <div key={index} className="flex min-w-0 flex-col gap-1">
                        <div
                            className={cn("flex min-w-0 items-start gap-2", depthClass(part.depth))}
                        >
                            <Icon
                                aria-hidden
                                className={cn("mt-0.5 size-3.5 shrink-0", look.tone)}
                            />
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                                <code className="text-code text-ink font-mono break-all">
                                    <CommandCode
                                        command={bare(source, part.pos, part.end, part.command)}
                                    />
                                </code>
                                {(part.command?.redirects ?? []).map((redirect) => (
                                    <Badge key={redirect.pos} className="max-w-full">
                                        <span className="truncate">
                                            {redirectLabel(source, redirect)}
                                        </span>
                                    </Badge>
                                ))}
                            </div>
                        </div>
                        {part.operator === undefined ? null : (
                            <div
                                className={cn(
                                    "text-meta text-faint flex items-center gap-1",
                                    depthClass(next?.kind === "command" ? next.depth : part.depth),
                                )}
                            >
                                <CornerDownRight aria-hidden className="size-3" />
                                {JOINS[part.operator] ?? part.operator}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
