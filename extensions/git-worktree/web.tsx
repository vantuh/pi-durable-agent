import { FolderX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { callAction } from "@/sdk/actions.ts";
import type {
    NewSessionCollected,
    NewSessionProps,
    StatusProps,
    WebExtension,
} from "@/sdk/types.ts";

import { make, state, type WorktreeState } from "./refs.ts";

const NAME = "name";

// Shown on a phone too, unlike the branch badges: a session whose folder is gone cannot work at all.
const GONE =
    "border-danger text-danger inline-flex h-4 max-w-full min-w-0 shrink px-1.5 [&>svg]:size-2.5";

function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
}

/**
 * The worktree of the open session, read again whenever the run state changes: the session keeps no
 * word of its own that it was a worktree, so the server answers instead.
 */
function useWorktree(session: StatusProps["session"]): WorktreeState | null {
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
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run ending (busy going false) is when the folder may have gone
    }, [id, cwd, busy]);

    return found;
}

/** The worktree a session works in, in red once its folder is gone: then nothing it runs can work. */
function Gone({ session }: StatusProps) {
    const worktree = useWorktree(session);

    if (worktree === null || !worktree.gone) {
        return null;
    }

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
    status: [{ id: "worktree", slot: "title", component: Gone }],
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
