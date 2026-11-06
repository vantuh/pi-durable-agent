import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { Todo } from "../refs.ts";
import type { Patch } from "./todo-patch.ts";

const DEBOUNCE_MS = 600;

/** The title and description, edited in place: the title on Enter or blur, the description as you type. */
export function TodoDetails({ todo, onChange }: { todo: Todo; onChange: (patch: Patch) => void }) {
    const [title, setTitle] = useState(todo.title);
    const [description, setDescription] = useState(todo.description);
    const unsaved = useRef<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const save = useRef(onChange);

    useEffect(() => {
        save.current = onChange;
    }, [onChange]);

    const flush = useCallback((): void => {
        clearTimeout(timer.current);

        if (unsaved.current !== null) {
            save.current({ description: unsaved.current });
            unsaved.current = null;
        }
    }, []);

    // Collapsing the row or closing the panel keeps what was typed in the last moment.
    useEffect(() => flush, [flush]);

    const commitTitle = (): void => {
        const text = title.trim();

        if (text === "") {
            setTitle(todo.title);
        } else if (text !== todo.title) {
            onChange({ title: text });
        }
    };

    return (
        <div className="flex flex-col gap-1.5 pt-0.5 pr-2 pb-2 pl-14">
            <Input
                value={title}
                aria-label="Title"
                onChange={(event) => {
                    setTitle(event.target.value);
                }}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    }
                }}
            />
            <Textarea
                value={description}
                rows={4}
                placeholder="Description"
                onChange={(event) => {
                    setDescription(event.target.value);
                    unsaved.current = event.target.value;
                    clearTimeout(timer.current);
                    timer.current = setTimeout(flush, DEBOUNCE_MS);
                }}
                onBlur={flush}
                className="resize-y"
            />
        </div>
    );
}
