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
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronRight, GripVertical, Text, Trash2 } from "lucide-react";
import {
    type CSSProperties,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast.ts";
import { cn } from "@/lib/utils";
import { callAction } from "@/sdk/actions.ts";

import type { ActionRef } from "../../shared/extension-api.ts";
import {
    addTodo,
    listTodos,
    moveTodo,
    removeTodo,
    restoreTodo,
    type Todo,
    updateTodo,
} from "./refs.ts";
import { setCount } from "./store.ts";

const DEBOUNCE_MS = 600;

type Patch = Partial<Omit<Todo, "id">>;

const messageOf = (failure: unknown, fallback: string): string =>
    failure instanceof Error ? failure.message : fallback;

/**
 * The repository's to-dos. A change shows at once and goes to the server after the ones before it,
 * so an undo never overtakes its removal; the answer replaces the list once nothing else is waiting.
 * A change the server refuses shows its error and re-reads the list.
 */
function useTodos(id: number) {
    const [items, setItems] = useState<Todo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const waiting = useRef(0);

    const show = useCallback(
        (todos: Todo[]) => {
            setItems(todos);
            setCount(id, todos.filter((todo) => !todo.done).length);
        },
        [id],
    );

    const reload = useCallback(async (): Promise<void> => {
        try {
            const todos = await callAction(listTodos, undefined, id);

            if (todos !== null) {
                show(todos);
            }
        } catch (failure) {
            setError(messageOf(failure, "The to-dos could not be read."));
        }
    }, [id, show]);

    const run = useCallback(
        async <Args,>(
            ref: ActionRef<Args, Todo[]>,
            args: Args,
            local: (todos: Todo[]) => Todo[],
        ): Promise<void> => {
            setItems((current) => (current === null ? null : local(current)));
            waiting.current += 1;

            const sent = queue.current.then(() => callAction(ref, args, id));

            queue.current = sent.catch(() => undefined);

            try {
                const todos = await sent;

                if (waiting.current === 1) {
                    show(todos);
                }

                setError(null);
            } catch (failure) {
                setError(messageOf(failure, "The to-dos were not saved."));
                await reload();
            } finally {
                waiting.current -= 1;
            }
        },
        [id, show, reload],
    );

    useEffect(() => {
        let alive = true;
        const refresh = async (): Promise<void> => {
            try {
                const todos = await callAction(listTodos, undefined, id);

                // A change still on its way would be undone on screen by this older list.
                if (alive && todos !== null && waiting.current === 0) {
                    show(todos);
                }
            } catch (failure) {
                if (alive) {
                    setError(messageOf(failure, "The to-dos could not be read."));
                }
            }
        };
        const onFocus = (): void => {
            void refresh();
        };

        void refresh();
        window.addEventListener("focus", onFocus);

        return () => {
            alive = false;
            window.removeEventListener("focus", onFocus);
        };
    }, [id, show]);

    return { items, error, run };
}

export function Todos({ id, tabs }: { id: number; tabs: ReactNode }) {
    const { items, error, run } = useTodos(id);
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
            <div className="border-edge-soft text-meta flex items-center gap-2 border-b px-3 py-1.5">
                {tabs}
            </div>

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
                    onChange={(event) => {
                        setTitle(event.target.value);
                    }}
                />
            </form>

            {error === null ? null : (
                <Alert className="text-interface rounded-none px-3 py-1">{error}</Alert>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                {items?.length === 0 ? (
                    <p className="text-faint text-interface px-2 py-2">Nothing to do.</p>
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

type RowProps = {
    todo: Todo;
    expanded: boolean;
    onExpand: () => void;
    onChange: (patch: Patch) => void;
    onRemove: () => void;
};

/** An open to-do: dragged by its grip only, so a tap on the title and a scroll on a phone stay what they are. */
function SortableRow(props: RowProps) {
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

function Row({
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
            className={cn("group rounded-control", dragging && "bg-raised relative z-10")}
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
            {expanded ? <Details todo={todo} onChange={onChange} /> : null}
        </li>
    );
}

/** The title and description, edited in place: the title on Enter or blur, the description as you type. */
function Details({ todo, onChange }: { todo: Todo; onChange: (patch: Patch) => void }) {
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
