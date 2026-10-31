import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { callAction } from "@/sdk/actions.ts";
import type { NewSessionCollected, NewSessionProps, WebExtension } from "@/sdk/types.ts";

import { head, make } from "./refs.ts";

const NAME = "name";

function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
}

/** The branch the worktree would start from; null while it is being read, or for a folder without git. */
function useHead(cwd: string | null): string | null {
    const [found, setFound] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;

        void (async () => {
            let read: string | null = null;

            try {
                read = cwd === null ? null : await callAction(head, { cwd }, null);
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
    }, [cwd]);

    return found;
}

/** A name, and which branch it will start from: the folder's own tip, its local commits and all. */
function Worktree({ cwd, use, refused }: NewSessionProps) {
    const [on, setOn] = useState(false);
    const [name, setName] = useState("");
    const field = useRef<HTMLInputElement>(null);
    const starting = useHead(cwd);
    // An empty name is not a mistake yet, only unfinished: it says so in grey and leaves the field
    // alone. A name that was given and refused is the mistake, and that one reddens the field.
    const unfinished = refused !== null && name.trim() === "";
    const failed = refused !== null && !unfinished;

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

                {on ? (
                    <>
                        <Input
                            ref={field}
                            type="text"
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                            }}
                            placeholder="name, in a branch of its own"
                            aria-label="Worktree name"
                            aria-invalid={failed}
                            aria-describedby={refused === null ? undefined : "worktree-refused"}
                            className="text-meta w-56"
                        />
                        {starting === null ? null : (
                            <span className="text-meta text-faint">
                                from <span className="font-mono">{starting}</span>, uncommitted
                                changes left out
                            </span>
                        )}
                    </>
                ) : null}
            </div>

            {refused === null ? null : (
                <p
                    id="worktree-refused"
                    className={unfinished ? "text-meta text-faint" : "text-meta text-danger"}
                >
                    {refused}
                </p>
            )}
        </div>
    );
}

export default {
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
