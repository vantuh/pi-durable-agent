import { Check, FolderGit2, FolderX, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { StatusProps } from "@/sdk/types.ts";

import { messageOf } from "../../../shared/guards.ts";
import { create, folderOf, move, slugOf, type WorktreeChoice } from "../refs.ts";
import { RemoveWorktreeDialog } from "./remove-worktree-dialog.tsx";
import { useWorktreeChoices } from "./use-worktree-choices.ts";
import { useWorktree } from "./use-worktree.ts";

/** What the main checkout is called wherever the repository's worktrees are offered. */
const MAIN = "Main checkout";

// Shown on a phone too, unlike the branch badge: it is the one way to leave a worktree, and a session
// whose folder is gone cannot work at all.
const WORKTREE = "h-4 max-w-full min-w-0 shrink px-1.5 [&>svg]:size-2.5";

/** A worktree's name in a menu and in the badge: its own folder's, never the branch it happens to be on. */
function folderNameOf(choice: WorktreeChoice): string {
    return choice.main ? MAIN : (choice.root.split("/").pop() ?? choice.root);
}

/**
 * The worktree a session works in, named by its folder: a menu of its repository's other worktrees to
 * move to, and a name nothing has, which makes a worktree and moves the session into it at once. A
 * worktree of this server's also offers the × that removes it; once its folder is gone the name is red,
 * nothing the session runs can work, and there is nothing left to remove.
 */
export function Mark({ session }: StatusProps) {
    const { worktree, setWorktree } = useWorktree(session);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [pending, setPending] = useState(false);
    const [asking, setAsking] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const found = useWorktreeChoices(open, cwd, id);

    if (worktree === null || id === null) {
        return null;
    }

    const choices = found.at === cwd ? found.choices : [];
    const wanted = query.trim();
    const needle = wanted.toLowerCase();
    // Either name finds a worktree: the folder it is, and the branch it is on.
    const shown = choices.filter(
        (choice) =>
            folderNameOf(choice).toLowerCase().includes(needle) ||
            choice.name.toLowerCase().includes(needle),
    );
    // The spaces around it are not part of a name, and the slug is what a new worktree and its branch
    // would be called: a folder or a branch that is already there is that worktree to pick, never a
    // second one to put beside it.
    const slug = slugOf(wanted);
    const taken = choices.some(
        (choice) =>
            folderNameOf(choice).toLowerCase() === needle ||
            folderNameOf(choice) === folderOf(slug) ||
            choice.name === wanted ||
            choice.name === slug,
    );
    const creatable = !worktree.gone && found.at === cwd && slug !== "" && !taken;

    const goTo = async (root: string) => {
        if (pending) {
            return;
        }

        setPending(true);

        try {
            const entered = await callAction(move, { worktree: root }, id);

            setOpen(false);

            // The agent still has the old folder in its head; the draft tells it, and the person sends it.
            if (entered.moved) {
                appendComposerDraft(id, `Worktree changed to ${entered.path}.`);
            }
        } catch (error) {
            toast.error(messageOf(error));
        } finally {
            setPending(false);
        }
    };

    const makeHere = async (name: string) => {
        if (pending) {
            return;
        }

        setPending(true);

        try {
            const entered = await callAction(create, { name }, id);

            setOpen(false);
            appendComposerDraft(id, `Worktree changed to ${entered.path}.`);
        } catch (error) {
            toast.error(messageOf(error));
        } finally {
            setPending(false);
        }
    };

    return (
        <>
            <span className="flex min-w-0 items-center gap-0.5">
                <Popover
                    open={open}
                    onOpenChange={(next) => {
                        setOpen(next);

                        if (next) {
                            setQuery("");
                        }
                    }}
                >
                    {/* Not while the agent runs: its files would change under it. */}
                    <PopoverTrigger asChild disabled={session?.busy === true || pending}>
                        <Badge
                            asChild
                            tone={worktree.gone ? "danger" : "muted"}
                            title={
                                worktree.gone
                                    ? `The worktree ${worktree.name} was deleted: choose a checkout to move this session`
                                    : worktree.main
                                      ? `The main checkout ${worktree.folder}`
                                      : worktree.ours
                                        ? `Worktree ${worktree.folder}, made by this server`
                                        : `Worktree ${worktree.folder}, made elsewhere`
                            }
                            className={WORKTREE}
                        >
                            <button type="button">
                                {worktree.gone ? <FolderX /> : <FolderGit2 />}
                                <span className="truncate">{worktree.name}</span>
                            </button>
                        </Badge>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        size="menu"
                        className="w-96 max-w-[calc(100vw-1rem)]"
                        aria-label="Worktree"
                        onOpenAutoFocus={(event) => {
                            // The keys must work at once: a search box that waits for a click reads as broken.
                            event.preventDefault();
                            search.current?.focus();
                        }}
                    >
                        <Command shouldFilter={false} label="Worktrees">
                            <CommandInput
                                ref={search}
                                value={query}
                                onValueChange={setQuery}
                                placeholder="Search worktrees"
                            />
                            <ScrollArea viewportProps={{ className: "max-h-72" }}>
                                <CommandList label="Worktrees" className="pb-1">
                                    {shown.map((choice) => (
                                        <CommandItem
                                            key={choice.root}
                                            value={choice.root}
                                            disabled={pending}
                                            onSelect={() => {
                                                void goTo(choice.root);
                                            }}
                                        >
                                            <span className="truncate">{folderNameOf(choice)}</span>
                                            {choice.main ||
                                            choice.name === folderNameOf(choice) ? null : (
                                                <span className="text-faint text-meta ml-auto shrink-0 truncate">
                                                    {choice.name}
                                                </span>
                                            )}
                                            {choice.current ? (
                                                <Check className="text-accent size-3 shrink-0" />
                                            ) : null}
                                        </CommandItem>
                                    ))}
                                    {creatable ? (
                                        <CommandItem
                                            // A worktree's root is an absolute path, so no row can share this value.
                                            value={`create:${slug}`}
                                            disabled={pending}
                                            onSelect={() => {
                                                void makeHere(wanted);
                                            }}
                                        >
                                            <Plus className="size-3 shrink-0" />
                                            <span className="truncate">
                                                Create worktree “{slug}”
                                            </span>
                                        </CommandItem>
                                    ) : null}
                                    {found.at === cwd && shown.length === 0 && !creatable ? (
                                        <CommandEmpty>No worktree matches.</CommandEmpty>
                                    ) : null}
                                </CommandList>
                            </ScrollArea>
                        </Command>
                    </PopoverContent>
                </Popover>

                {worktree.ours && !worktree.gone ? (
                    /* Beside the pill, not in it: the pill is the menu's trigger, and a button inside a
                       button takes neither click. */
                    <Hint label={`Remove the worktree ${worktree.name}`}>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove the worktree ${worktree.name}`}
                            onClick={() => {
                                setAsking(true);
                            }}
                            className="text-faint hover:text-danger size-3.5 shrink-0 p-0 hover:bg-transparent"
                        >
                            <X className="size-3" />
                        </Button>
                    </Hint>
                ) : null}
            </span>

            <RemoveWorktreeDialog
                worktree={worktree}
                session={session}
                open={asking}
                onOpenChange={setAsking}
                onRemoved={() => {
                    setWorktree({ ...worktree, gone: true });
                }}
            />
        </>
    );
}
