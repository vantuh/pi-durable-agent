import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { callAction } from "@/sdk/actions.ts";
import type { NewSessionCollected, NewSessionProps, WebExtension } from "@/sdk/types.ts";

import { make } from "./refs.ts";

const NAME = "name";

function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
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

                {on ? (
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
                        className="text-meta w-56"
                    />
                ) : null}
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
