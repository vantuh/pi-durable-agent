import { useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { NewSessionCollected, NewSessionProps, WebExtension } from "@/sdk/types.ts";

import { head, make } from "./refs.ts";

const NAME = "name";

const FIELD =
    "rounded-control border-edge bg-sunken text-ink text-meta focus-visible:ring-accent border px-2 py-1 outline-none focus-visible:ring-2";

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
function Worktree({ cwd, use }: NewSessionProps) {
    const [on, setOn] = useState(false);
    const [name, setName] = useState("");
    const field = useRef<HTMLInputElement>(null);
    const starting = useHead(cwd);

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
                    <input
                        ref={field}
                        type="text"
                        value={name}
                        onChange={(event) => {
                            setName(event.target.value);
                        }}
                        placeholder="name, in a branch of its own"
                        aria-label="Worktree name"
                        className={`${FIELD} w-56`}
                    />
                    {starting === null ? null : (
                        <span className="text-meta text-faint">
                            from <span className="font-mono">{starting}</span>, uncommitted changes
                            left out
                        </span>
                    )}
                </>
            ) : null}
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
