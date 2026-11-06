import { ChevronDown, FolderGit2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
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
import { callAction } from "@/sdk/actions.ts";
import type { NewSessionProps } from "@/sdk/types.ts";

import { worktrees, type WorktreeChoice } from "../refs.ts";
import { NAME, PATH } from "./collected.ts";

/** The menu's value for the folder as picked: no folder is named this, so no choice reads as it. */
const PICKED = ".";

/**
 * Where the session starts: the picked folder or one of the repository's worktrees, read when the
 * folder changes, and a new worktree made here — one answer of the two, never both.
 */
export function Worktree({ cwd, use, refused }: NewSessionProps) {
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
