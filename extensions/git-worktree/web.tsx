import { CircleAlert, FolderGit2, FolderX, X } from "lucide-react";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type {
    NewSessionCollected,
    NewSessionProps,
    StatusProps,
    WebExtension,
} from "@/sdk/types.ts";

import { make, remove, state, type WorktreeState } from "./refs.ts";

const NAME = "name";

// Shown on a phone too, unlike the branch badge: it carries the button that removes a worktree, and
// a session whose folder is gone cannot work at all.
const WORKTREE = "h-4 max-w-full min-w-0 shrink px-1.5 [&>svg]:size-2.5";

function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
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

/** A name, and the field that says when it will not do. */
function Worktree({ use, refused }: NewSessionProps) {
    const [on, setOn] = useState(false);
    const [name, setName] = useState("");
    const field = useRef<HTMLInputElement>(null);
    // An empty name is not a mistake yet, only unfinished: the field says nothing until a name is
    // given, and a name that was given and refused is what reddens it.
    const failed = refused !== null && name.trim() !== "";

    // Ticking the box asks for the name next, so put the caret there: not on load, on that click.
    useEffect(() => {
        if (on) {
            field.current?.focus();
        }
    }, [on]);

    useEffect(() => {
        use(on ? { [NAME]: name } : null);
    }, [on, name, use]);

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Field orientation="horizontal">
                    <Checkbox
                        id="new-worktree"
                        checked={on}
                        onCheckedChange={(checked) => {
                            setOn(checked === true);
                        }}
                    />
                    <Label htmlFor="new-worktree">New worktree</Label>
                </Field>

                {/* In the row from the start, unseen until ticked: none of the rows around it move. */}
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
                    className={on ? "text-meta w-56" : "text-meta invisible w-56"}
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
                collected === null || nameOf(collected) !== "" ? null : "Name the worktree.",
            place: async (cwd, collected) => {
                const name = nameOf(collected);

                if (name === "") {
                    throw new Error("Name the worktree.");
                }

                return (await callAction(make, { cwd, name }, null)).path;
            },
        },
    ],
} satisfies WebExtension;
