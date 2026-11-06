import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast.ts";
import { Toolbar } from "@/ui/pane.tsx";

import { addTodo, moveTodo, removeTodo, restoreTodo, type Todo, updateTodo } from "../refs.ts";
import { Row } from "./row.tsx";
import { SortableRow } from "./sortable-row.tsx";
import type { Patch } from "./todo-patch.ts";
import { useTodoList } from "./use-todo-list.ts";

export function Todos({ id, tabs }: { id: number; tabs: ReactNode }) {
    const { items, error, run } = useTodoList(id);
    const [title, setTitle] = useState("");
    const [expanded, setExpanded] = useState<number | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const open = items?.filter((todo) => !todo.done) ?? [];
    const done = items?.filter((todo) => todo.done) ?? [];

    const change = (todo: Todo, patch: Patch): void => {
        void run(updateTodo, { id: todo.id, ...patch }, (todos) =>
            todos.map((item) => (item.id === todo.id ? { ...item, ...patch } : item)),
        );
    };

    const remove = (todo: Todo): void => {
        const index = items?.findIndex((item) => item.id === todo.id) ?? -1;

        void run(removeTodo, { id: todo.id }, (todos) =>
            todos.filter((item) => item.id !== todo.id),
        );
        toast(`Deleted “${todo.title}”`, {
            duration: 5000,
            action: {
                label: "Undo",
                onClick: () => {
                    void run(restoreTodo, { todo, index }, (todos) =>
                        todos.toSpliced(index, 0, todo),
                    );
                },
            },
        });
    };

    const onDragEnd = ({ active, over }: DragEndEvent): void => {
        if (
            items === null ||
            over === null ||
            typeof active.id !== "number" ||
            typeof over.id !== "number" ||
            active.id === over.id
        ) {
            return;
        }

        const from = items.findIndex((item) => item.id === active.id);
        const to = items.findIndex((item) => item.id === over.id);

        void run(moveTodo, { id: active.id, over: over.id }, (todos) => arrayMove(todos, from, to));
    };

    const row = (todo: Todo) => ({
        todo,
        expanded: expanded === todo.id,
        onExpand: () => {
            setExpanded(expanded === todo.id ? null : todo.id);
        },
        onChange: (patch: Patch) => {
            change(todo, patch);
        },
        onRemove: () => {
            remove(todo);
        },
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Toolbar className="text-meta">{tabs}</Toolbar>

            <form
                className="px-3 pt-2 pb-1"
                onSubmit={(event) => {
                    event.preventDefault();

                    const text = title.trim();

                    if (text !== "") {
                        setTitle("");
                        void run(addTodo, { title: text }, (todos) => todos);
                    }
                }}
            >
                <Input
                    value={title}
                    disabled={items === null}
                    placeholder="Add a to-do"
                    aria-label="Add a to-do"
                    onChange={(event) => {
                        setTitle(event.target.value);
                    }}
                />
            </form>

            {error === null ? null : <Alert className="text-interface px-3 py-1">{error}</Alert>}

            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                {items?.length === 0 ? (
                    <Empty className="text-interface px-2 py-2">Nothing to do.</Empty>
                ) : null}

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                >
                    <SortableContext
                        items={open.map((todo) => todo.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <ul>
                            {open.map((todo) => (
                                <SortableRow key={todo.id} {...row(todo)} />
                            ))}
                        </ul>
                    </SortableContext>
                </DndContext>

                {done.length === 0 ? null : (
                    <Collapsible className="mt-2">
                        <CollapsibleTrigger className="group text-meta text-faint hover:text-muted flex items-center gap-1 px-2 py-1">
                            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                            Done ({done.length})
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <ul>
                                {done.map((todo) => (
                                    <Row key={todo.id} {...row(todo)} />
                                ))}
                            </ul>
                        </CollapsibleContent>
                    </Collapsible>
                )}
            </div>
        </div>
    );
}
