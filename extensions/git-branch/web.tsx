import { GitBranch, FolderGit2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { messageOf } from "../../shared/guards.ts";
import { branch, branches, checkout, type Branch as BranchChoice, type Checkout } from "./refs.ts";

const BADGE = "hidden h-4 max-w-full min-w-0 shrink px-1.5 sm:inline-flex [&>svg]:size-2.5";

function useCheckout(session: StatusProps["session"]): [Checkout | null, (next: Checkout) => void] {
    const [current, setCurrent] = useState<Checkout | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        if (id === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            let found: Checkout | null = null;

            try {
                found = await callAction(branch, undefined, id);
            } catch {
                found = null;
            }

            if (alive) {
                setCurrent(found);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new folder, a run ending (busy going false), and a change its own commits do not show, can change the branch
    }, [id, cwd, busy, session?.revision]);

    return [current, setCurrent];
}

function Branch({ session }: StatusProps) {
    const [current, setCurrent] = useCheckout(session);
    const [names, setNames] = useState<BranchChoice[]>([]);
    const id = session?.id ?? null;

    if (current === null || id === null) {
        return null;
    }

    const load = (open: boolean) => {
        if (open) {
            void callAction(branches, undefined, id).then(setNames, () => {
                setNames([]);
            });
        }
    };

    const switchTo = async (name: string) => {
        try {
            const done = await callAction(checkout, { branch: name }, id);

            setCurrent({ branch: done.branch });

            // The agent still has the old folder in its head; the draft tells it, and the person sends it.
            if (done.worktree !== null) {
                appendComposerDraft(
                    id,
                    `Worktree changed to ${done.worktree} (branch ${done.branch}).`,
                );
            }
        } catch (failure) {
            toast.error(messageOf(failure));
        }
    };

    return (
        <DropdownMenu modal={false} onOpenChange={load}>
            {/* Not while the agent runs: its files would change under it. */}
            <DropdownMenuTrigger asChild disabled={session?.busy === true}>
                <Badge asChild title={`Branch ${current.branch}`} className={BADGE}>
                    <button type="button">
                        <GitBranch />
                        <span className="truncate">{current.branch}</span>
                    </button>
                </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                <ScrollArea viewportProps={{ className: "max-h-72" }}>
                    <DropdownMenuRadioGroup
                        value={current.branch}
                        onValueChange={(name) => {
                            void switchTo(name);
                        }}
                    >
                        {names.map(({ name, worktree }) => (
                            <DropdownMenuRadioItem key={name} value={name}>
                                <span className="truncate">{name}</span>
                                {worktree === null ? null : (
                                    <span
                                        title={worktree}
                                        className="text-faint text-meta ml-auto flex shrink-0 items-center gap-1"
                                    >
                                        <FolderGit2 className="size-3" />
                                        {worktree.split("/").pop()}
                                    </span>
                                )}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default {
    status: [{ id: "branch", slot: "title", component: Branch }],
} satisfies WebExtension;
