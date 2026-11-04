import { ChevronDown, CircleAlert, FolderGit2, FolderX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type {
    NewSessionCollected,
    NewSessionProps,
    StatusProps,
    WebExtension,
} from "@/sdk/types.ts";

import {
    linked,
    make,
    remove,
    state,
    type WorktreeState,
    type WorktreeChoice,
    worktrees,
} from "./refs.ts";

const NAME = "name";
const PATH = "path";
/** The menu's value for the folder as picked: no folder is named this, so no choice reads as it. */
const PICKED = ".";

// Shown on a phone too, unlike the branch badge: it carries the button that removes a worktree, and
// a session whose folder is gone cannot work at all.
const WORKTREE = "h-4 max-w-full min-w-0 shrink px-1.5 [&>svg]:size-2.5";

function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
}

/** The worktree the person chose instead of the picked folder, or null for the folder as picked. */
function chosenOf(collected: NewSessionCollected | null): string | null {
    const path: unknown = collected?.[PATH];

    return typeof path === "string" && path !== "" ? path : null;
}

/**
 * The worktree of the open session, read again whenever the run state changes: the session keeps no
 * word of its own that it was a worktree, so the server answers instead.
 */
function useWorktree(session: StatusProps["session"]): {
    worktree: WorktreeState | null;
    setWorktree: (worktree: WorktreeState | null) => void;
} {
    const [found, setFound] = useState<WorktreeState | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        let alive = true;

        void (async () => {
            let read: WorktreeState | null = null;

            try {
                read = cwd === null ? null : await callAction(state, { cwd }, id);
            } catch {
                read = null;
            }

            if (alive) {
                setFound(read);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run ending (busy going false), and a change its own commits do not show, are when the folder may have gone
    }, [id, cwd, busy, session?.revision]);

    return { worktree: found, setWorktree: setFound };
}

/**
 * The worktree a session works in: a button that offers to remove it, or the same name in red once
 * its folder is gone — then nothing the session runs can work, and there is nothing left to remove.
 */
function Mark({ session }: StatusProps) {
    const { worktree, setWorktree } = useWorktree(session);
    const [asking, setAsking] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    if (worktree === null) {
        return null;
    }

    if (worktree.gone) {
        return (
            <Badge
                tone="danger"
                title={`The worktree ${worktree.name} was deleted: this session's folder is gone`}
                className={WORKTREE}
            >
                <FolderX />
                <span className="truncate">{worktree.name}</span>
            </Badge>
        );
    }

    return (
        <>
            <Badge
                title={
                    worktree.ours
                        ? `Worktree ${worktree.folder}, made by this server`
                        : `Worktree ${worktree.folder}, made elsewhere`
                }
                className={WORKTREE}
            >
                <FolderGit2 />
                <span className="truncate">{worktree.name}</span>
                {worktree.ours ? (
                    /* The pill is 16px tall: the × keeps the icon's own 14px box, and the fill stays
                       off, so nothing paints outside the badge. Badge owns the pill. */
                    <Hint label={`Remove the worktree ${worktree.name}`}>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove the worktree ${worktree.name}`}
                            onClick={() => {
                                setFailure(null);
                                setAsking(true);
                            }}
                            className="hover:text-danger -mr-0.5 size-3.5 shrink-0 p-0 hover:bg-transparent"
                        >
                            <X className="size-3" />
                        </Button>
                    </Hint>
                ) : null}
            </Badge>

            <AlertDialog
                open={asking}
                onOpenChange={(open) => {
                    if (!removing) {
                        setAsking(open);
                        setFailure(null);
                    }
                }}
            >
                <AlertDialogContent>
                    {/* The notice stands in for the line under the header. */}
                    <AlertDialogHeader className={failure === null ? undefined : "border-b-0"}>
                        <AlertDialogTitle>Remove the worktree {worktree.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {worktree.folder} goes, with everything in it that is not committed.
                            What is committed stays on the branch {worktree.name}. The session stays
                            too, but nothing it runs will work until a folder is there again.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {failure === null ? null : (
                        <Alert className="mx-3 mb-1">
                            <CircleAlert />
                            <span className="min-w-0">{failure}</span>
                        </Alert>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>No</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={removing}
                            onClick={(event) => {
                                // The answer is the removal: the question closes once it returns.
                                event.preventDefault();
                                setRemoving(true);
                                setFailure(null);

                                void (async () => {
                                    try {
                                        await callAction(
                                            remove,
                                            { cwd: session?.cwd ?? "" },
                                            session?.id ?? null,
                                        );
                                        setWorktree({ ...worktree, gone: true });
                                        setAsking(false);
                                    } catch (error) {
                                        setFailure(
                                            error instanceof Error
                                                ? error.message
                                                : "The worktree was not removed.",
                                        );
                                    } finally {
                                        setRemoving(false);
                                    }
                                })();
                            }}
                        >
                            {removing ? "Removing…" : "Remove worktree"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

/**
 * Where the session starts: the picked folder or one of the repository's worktrees, read when the
 * folder changes, and a new worktree made here — one answer of the two, never both.
 */
function Worktree({ cwd, use, refused }: NewSessionProps) {
    const [on, setOn] = useState(false);
    const [name, setName] = useState("");
    /** The picked folder the two below belong to: browsing is a new question, and both start over. */
    const [asked, setAsked] = useState(cwd);
    /** The repository's worktrees, with the folder they were read for: none for a folder outside git. */
    const [found, setFound] = useState<{ at: string | null; choices: WorktreeChoice[] }>({
        at: null,
        choices: [],
    });
    const [chosen, setChosen] = useState<WorktreeChoice | null>(null);
    const field = useRef<HTMLInputElement>(null);
    // An empty name is not a mistake yet, only unfinished: the field says nothing until a name is
    // given, and a name that was given and refused is what reddens it.
    const failed = refused !== null && on && name.trim() !== "";

    if (asked !== cwd) {
        // Not in an effect: the menu goes with the folder, in the render the folder changed in, so a
        // choice made for the old folder cannot be submitted while the new one is still on its way.
        setAsked(cwd);
        setFound({ at: null, choices: [] });
        setChosen(null);
    }

    // Ticking the box asks for the name next, so put the caret there: not on load, on that click.
    useEffect(() => {
        if (on) {
            field.current?.focus();
        }
    }, [on]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const read =
                cwd === null ? [] : await callAction(worktrees, { cwd }, null).catch(() => []);

            if (alive) {
                setFound({ at: cwd, choices: read });
            }
        })();

        return () => {
            alive = false;
        };
    }, [cwd]);

    const choices = found.at === cwd ? found.choices : [];

    useEffect(() => {
        use(on ? { [NAME]: name } : chosen === null ? null : { [PATH]: chosen.path });
    }, [on, name, chosen, use]);

    const mine = choices.find((choice) => choice.current);
    const others = choices.filter((choice) => !choice.current);
    const here = mine === undefined || mine.main ? "Main checkout" : mine.name;

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {others.length === 0 ? null : (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                className="bg-raised text-ink text-meta max-w-56 gap-1"
                            >
                                <FolderGit2 className="size-4" />
                                <span className="truncate">{chosen?.name ?? here}</span>
                                <ChevronDown className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        {/* A long branch name would widen the menu past a phone: it is cut to the screen. */}
                        <DropdownMenuContent align="start" className="max-w-[calc(100vw-1rem)]">
                            <ScrollArea viewportProps={{ className: "max-h-72" }}>
                                <DropdownMenuRadioGroup
                                    value={chosen?.path ?? PICKED}
                                    onValueChange={(value) => {
                                        // Picking a worktree is the other answer to a new one.
                                        setOn(false);
                                        setChosen(
                                            others.find((each) => each.path === value) ?? null,
                                        );
                                    }}
                                >
                                    <DropdownMenuRadioItem value={PICKED}>
                                        <span className="truncate">{here}</span>
                                    </DropdownMenuRadioItem>
                                    {others.map((choice) => (
                                        <DropdownMenuRadioItem
                                            key={choice.path}
                                            value={choice.path}
                                        >
                                            <span className="truncate">{choice.name}</span>
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                <Field orientation="horizontal">
                    <Checkbox
                        id="new-worktree"
                        checked={on}
                        onCheckedChange={(checked) => {
                            // A worktree and a new one are one answer: the other goes off.
                            setOn(checked === true);
                            setChosen(null);
                        }}
                    />
                    <Label htmlFor="new-worktree">New worktree</Label>
                </Field>

                {/* From `sm` the space is kept, unseen, so the row does not jump when a name is typed;
                    on a phone it would be a line of its own, empty, so it takes none until ticked. */}
                <Input
                    ref={field}
                    type="text"
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    aria-label="Worktree name"
                    aria-invalid={failed}
                    aria-describedby={failed ? "worktree-refused" : undefined}
                    className={
                        on ? "text-meta w-56" : "text-meta hidden w-56 sm:invisible sm:block"
                    }
                />
            </div>

            {failed ? <Alert id="worktree-refused">{refused}</Alert> : null}
        </div>
    );
}

export default {
    status: [{ id: "worktree", slot: "title", component: Mark }],
    newSession: [
        {
            id: "worktree",
            component: Worktree,
            blocked: (collected) =>
                collected !== null && Object.hasOwn(collected, NAME) && nameOf(collected) === ""
                    ? "Name the worktree."
                    : null,
            // The picker leaves the worktrees out of its lists: their repository's folder is the one to pick.
            omit: (folders) => callAction(linked, { folders: [...folders] }, null),
            place: async (cwd, collected) => {
                const chosen = chosenOf(collected);

                if (chosen !== null) {
                    return chosen;
                }

                const name = nameOf(collected);

                if (name === "") {
                    throw new Error("Name the worktree.");
                }

                return (await callAction(make, { cwd, name }, null)).path;
            },
        },
    ],
} satisfies WebExtension;
