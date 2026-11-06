import { useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Row, type RowProps } from "./row.tsx";

/** An open to-do: dragged by its grip only, so a tap on the title and a scroll on a phone stay what they are. */
export function SortableRow(props: RowProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.todo.id });

    return (
        <Row
            {...props}
            rowRef={setNodeRef}
            dragging={isDragging}
            style={{
                transform:
                    transform === null ? undefined : `translate3d(0, ${String(transform.y)}px, 0)`,
                transition,
            }}
            handle={
                <Button
                    ref={setActivatorNodeRef}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Drag to reorder"
                    className="text-faint hover:text-muted shrink-0 cursor-grab touch-none"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="size-4" />
                </Button>
            }
        />
    );
}
