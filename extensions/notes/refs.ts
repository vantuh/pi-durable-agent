import { actionRef } from "../../shared/extension-api.ts";

/** A note as it is on disk; `version` is a hash of `text`, and a missing note is the empty text. */
export type Note = { text: string; version: string };

/** `conflict`: the note changed since `base`; `text` and `version` are what is on disk now. */
export type WriteResult = { conflict: false; version: string } | ({ conflict: true } & Note);

function isNote(value: unknown): value is Note {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "text") === "string" &&
        typeof Reflect.get(value, "version") === "string"
    );
}

/** The session's repository note; null when the session has no folder. */
export const read = actionRef<undefined, Note | null>("notes", "read", (value) => {
    if (value === null || isNote(value)) {
        return value;
    }

    throw new Error("not a note");
});

/** Writes only if the note on disk still has the version `base`. */
export const write = actionRef<{ text: string; base: string }, WriteResult>(
    "notes",
    "write",
    (value) => {
        if (typeof value === "object" && value !== null) {
            const version: unknown = Reflect.get(value, "version");

            if (Reflect.get(value, "conflict") === false && typeof version === "string") {
                return { conflict: false, version };
            }

            if (Reflect.get(value, "conflict") === true && isNote(value)) {
                return { conflict: true, text: value.text, version: value.version };
            }
        }

        throw new Error("not a write result");
    },
);

/** One to-do of the repository; the list's order is the order the person dragged it into. */
export type Todo = { id: number; title: string; description: string; done: boolean };

function isTodo(value: unknown): value is Todo {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "id") === "number" &&
        typeof Reflect.get(value, "title") === "string" &&
        typeof Reflect.get(value, "description") === "string" &&
        typeof Reflect.get(value, "done") === "boolean"
    );
}

export function asTodos(value: unknown): Todo[] {
    if (Array.isArray(value) && value.every(isTodo)) {
        return value;
    }

    throw new Error("not a to-do list");
}

/** Every to-do changes on the server and answers with the whole list as it now is. */
const todoAction = <Args>(name: string) => actionRef<Args, Todo[]>("notes", name, asTodos);

/** The session's repository to-dos; null when the session has no folder. */
export const listTodos = actionRef<undefined, Todo[] | null>("notes", "todos", (value) =>
    value === null ? null : asTodos(value),
);
export const addTodo = todoAction<{ title: string }>("addTodo");
export const updateTodo = todoAction<{ id: number } & Partial<Omit<Todo, "id">>>("updateTodo");
/** Puts `id` where `over` is, the way a sortable list drops one item on another. */
export const moveTodo = todoAction<{ id: number; over: number }>("moveTodo");
export const removeTodo = todoAction<{ id: number }>("removeTodo");
/** Puts a removed to-do back at `index`: the undo of `removeTodo`. */
export const restoreTodo = todoAction<{ todo: Todo; index: number }>("restoreTodo");
