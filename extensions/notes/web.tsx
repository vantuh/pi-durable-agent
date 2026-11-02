import { NotebookPen } from "lucide-react";
import { useEffect } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { NotesPanel } from "./panel.tsx";
import { listTodos } from "./refs.ts";
import { setCount, useCount } from "./store.ts";

/** Open to-dos of the session's repository, read at mount and on window focus; the panel sets it on each change. */
function OpenTodos({ session }: StatusProps) {
    const id = session?.id ?? null;
    const hasFolder = session !== null && session.cwd !== null;
    const count = useCount(id);

    useEffect(() => {
        if (id === null || !hasFolder) {
            return undefined;
        }

        let alive = true;
        const refresh = async (): Promise<void> => {
            try {
                const todos = await callAction(listTodos, undefined, id);

                if (alive && todos !== null) {
                    setCount(id, todos.filter((todo) => !todo.done).length);
                }
            } catch {
                // The panel says what went wrong; a badge that cannot read just keeps its last count.
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
    }, [id, hasFolder]);

    return count > 0 ? count : null;
}

export default {
    panels: [
        {
            id: "notes",
            title: "Notes",
            icon: <NotebookPen className="size-4" />,
            badge: OpenTodos,
            component: NotesPanel,
        },
    ],
} satisfies WebExtension;
