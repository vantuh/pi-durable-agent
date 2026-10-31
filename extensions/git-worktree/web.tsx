import { CircleAlert, FolderGit2, FolderX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
const WORKTREE = "inline-flex h-4 max-w-full min-w-0 shrink gap-1 px-1.5 [&>svg]:size-2.5";
const GONE = `border-danger text-danger ${WORKTREE}`;

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
                title={`The worktree ${worktree.name} was deleted: this session's folder is gone`}
                className={GONE}
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
                    <button
                        type="button"
                        title={`Remove the worktree ${worktree.name}`}
                        aria-label={`Remove the worktree ${worktree.name}`}
                        onClick={() => {
                            setFailure(null);
                            setAsking(true);
                        }}
                        className="hover:text-danger -mr-0.5 flex size-3.5 shrink-0 items-center justify-center"
                    >
                        <X className="size-3" />
                    </button>
                ) : null}
            </Badge>

            <Dialog
                open={asking}
                onOpenChange={(open) => {
                    if (!removing) {
                        setAsking(open);
                        setFailure(null);
                    }
                }}
            >
                <DialogContent>
                    {/* The notice stands in for the line under the header, and keeps the dialog's
                        own side margins, which the header's do not reach past the close button. */}
                    <DialogHeader className={failure === null ? undefined : "border-b-0"}>
                        <DialogTitle>Remove the worktree {worktree.name}?</DialogTitle>
                        <DialogDescription>
                            {worktree.folder} goes, with everything in it that is not committed.
                            What is committed stays on the branch {worktree.name}. The session stays
                            too, but nothing it runs will work until a folder is there again.
                        </DialogDescription>
                    </DialogHeader>

                    {failure === null ? null : (
                        <div className="bg-danger/10 text-meta mx-3 mb-1 flex items-start gap-2 rounded-lg px-3 py-2">
                            <CircleAlert className="text-danger mt-0.5 size-3.5 shrink-0" />
                            <span className="text-danger min-w-0 break-words">{failure}</span>
                        </div>
                    )}

                    {/* No first on a phone too: the safe answer is where the thumb lands. */}
                    <DialogFooter className="flex-col sm:flex-row">
                        <Button
                            variant="ghost"
                            disabled={removing}
                            onClick={() => {
                                setAsking(false);
                                setFailure(null);
                            }}
                        >
                            No
                        </Button>
                        <Button
                            disabled={removing}
                            className="bg-danger text-canvas hover:bg-danger/90"
                            onClick={() => {
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
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
                <label className="text-muted text-meta flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={on}
                        onChange={(event) => {
                            setOn(event.target.checked);
                        }}
                    />
                    New worktree
                </label>

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

            {failed ? (
                <p id="worktree-refused" className="text-meta text-danger">
                    {refused}
                </p>
            ) : null}
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
