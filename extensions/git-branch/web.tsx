import { Check, FolderGit2, GitBranch, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { messageOf } from "../../shared/guards.ts";
import {
    branch,
    branches,
    checkout,
    create,
    type Branch as BranchChoice,
    type Checkout,
} from "./refs.ts";

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
    // False while the list loads, and after it could not be read: there is nothing to create against.
    const [listed, setListed] = useState(false);
    const [query, setQuery] = useState("");
    const [pending, setPending] = useState(false);
    const [open, setOpen] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    const id = session?.id ?? null;

    if (current === null || id === null) {
        return null;
    }

    const load = () => {
        setQuery("");
        setListed(false);
        void (async () => {
            try {
                setNames(await callAction(branches, undefined, id));
                setListed(true);
            } catch (failure) {
                setNames([]);
                toast.error(messageOf(failure));
            }
        })();
    };

    const finish = (name: string) => {
        setCurrent({ branch: name });
        setOpen(false);
    };

    const switchTo = async (name: string) => {
        if (pending) {
            return;
        }

        setPending(true);

        try {
            const moved = await callAction(checkout, { branch: name }, id);

            finish(moved.branch);

            // The agent still has the old folder in its head; the draft tells it, and the person sends it.
            if (moved.worktree !== null) {
                appendComposerDraft(
                    id,
                    `Worktree changed to ${moved.worktree} (branch ${moved.branch}).`,
                );
            }
        } catch (failure) {
            toast.error(messageOf(failure));
        } finally {
            setPending(false);
        }
    };

    const createBranch = async (name: string) => {
        if (pending) {
            return;
        }

        setPending(true);

        try {
            finish((await callAction(create, { branch: name }, id)).branch);
        } catch (failure) {
            toast.error(messageOf(failure));
        } finally {
            setPending(false);
        }
    };

    const needle = query.trim().toLowerCase();
    const shown = names.filter((each) => each.name.toLowerCase().includes(needle));
    // The spaces around it are not part of a name; git judges the rest.
    const wanted = query.trim();
    // Git names are case-sensitive, so `main` does not exist because `Main` does.
    const creatable = listed && wanted !== "" && !names.some((each) => each.name === wanted);

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);

                if (next) {
                    load();
                }
            }}
        >
            {/* Not while the agent runs: its files would change under it. */}
            <PopoverTrigger asChild disabled={session?.busy === true}>
                <Badge asChild title={`Branch ${current.branch}`} className={BADGE}>
                    <button type="button">
                        <GitBranch />
                        <span className="truncate">{current.branch}</span>
                    </button>
                </Badge>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                size="menu"
                className="w-96 max-w-[calc(100vw-1rem)]"
                aria-label="Branch"
                onOpenAutoFocus={(event) => {
                    // The keys must work at once: a search box that waits for a click reads as broken.
                    event.preventDefault();
                    search.current?.focus();
                }}
            >
                <Command shouldFilter={false} label="Branches">
                    <CommandInput
                        ref={search}
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search branches"
                    />
                    <ScrollArea viewportProps={{ className: "max-h-72" }}>
                        <CommandList label="Branches" className="pb-1">
                            {shown.map(({ name, worktree }) => (
                                <CommandItem
                                    key={name}
                                    value={name}
                                    disabled={pending}
                                    onSelect={() => {
                                        void switchTo(name);
                                    }}
                                >
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
                                    {name === current.branch ? (
                                        <Check className="text-accent size-3 shrink-0" />
                                    ) : null}
                                </CommandItem>
                            ))}
                            {creatable ? (
                                <CommandItem
                                    // ":" cannot be in a git name, so this row cannot share a branch's value.
                                    value={`create:${wanted}`}
                                    disabled={pending}
                                    onSelect={() => {
                                        void createBranch(wanted);
                                    }}
                                >
                                    <Plus className="size-3 shrink-0" />
                                    <span className="truncate">Create branch “{wanted}”</span>
                                </CommandItem>
                            ) : null}
                            {listed && shown.length === 0 && !creatable ? (
                                <CommandEmpty>No branch matches.</CommandEmpty>
                            ) : null}
                        </CommandList>
                    </ScrollArea>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function SessionBranch(props: StatusProps) {
    return <Branch key={props.session?.id} {...props} />;
}

export default {
    status: [{ id: "branch", slot: "title", component: SessionBranch }],
} satisfies WebExtension;
