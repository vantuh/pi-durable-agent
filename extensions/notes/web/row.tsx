import { Text, Trash2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Todo } from "../refs.ts";
import { TodoDetails } from "./todo-details.tsx";
import type { Patch } from "./todo-patch.ts";

export type RowProps = {
    todo: Todo;
    expanded: boolean;
    onExpand: () => void;
    onChange: (patch: Patch) => void;
    onRemove: () => void;
};

export function Row({
    todo,
    expanded,
    onExpand,
    onChange,
    onRemove,
    rowRef,
    dragging = false,
    style,
    handle,
}: RowProps & {
    rowRef?: (node: HTMLElement | null) => void;
    dragging?: boolean;
    style?: CSSProperties;
    handle?: ReactNode;
}) {
    return (
        <li
            ref={rowRef}
            style={style}
            className={cn("group", dragging && "bg-raised relative z-10")}
        >
            <div className="flex items-start gap-2 px-2 py-1">
                {handle ?? <span className="size-4 shrink-0" />}
                <Checkbox
                    checked={todo.done}
                    aria-label={todo.done ? "Mark as not done" : "Mark as done"}
                    onCheckedChange={(checked) => {
                        onChange({ done: checked === true });
                    }}
                    className="mt-0.75"
                />
                <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded}
                    onClick={onExpand}
                    className={cn(
                        "text-interface min-w-0 flex-1 justify-start break-words px-0 py-0 text-left",
                        todo.done ? "text-faint line-through" : "text-ink",
                    )}
                >
                    {todo.title}
                </Button>
                {todo.description === "" ? null : (
                    <Text
                        aria-label="Has a description"
                        className="text-faint mt-1 size-3.5 shrink-0"
                    />
                )}
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={onRemove}
                    className="text-faint hover:text-danger shrink-0 focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>
            {expanded ? <TodoDetails todo={todo} onChange={onChange} /> : null}
        </li>
    );
}
