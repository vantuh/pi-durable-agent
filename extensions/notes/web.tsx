import { NotebookPen } from "lucide-react";
import { useEffect } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { NotesPanel } from "./panel.tsx";
import { openTasks, read } from "./refs.ts";
import { flushed, isClaimed, setCount, useCount } from "./store.ts";

/** Open tasks of the session's note, read at mount and on window focus unless a panel holds the note. */
function OpenTasks({ session }: StatusProps) {
    const id = session?.id ?? null;
    const hasFolder = session !== null && session.cwd !== null;
    const count = useCount(id);

    useEffect(() => {
        if (id === null || !hasFolder) {
            return undefined;
        }

        let alive = true;
        const refresh = async (): Promise<void> => {
            if (isClaimed(id)) {
                return;
            }

            try {
                await flushed();

                if (!alive || isClaimed(id)) {
                    return;
                }

                const note = await callAction(read, undefined, id);

                if (alive && note !== null && !isClaimed(id)) {
                    setCount(id, openTasks(note.text));
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
            badge: OpenTasks,
            component: NotesPanel,
        },
    ],
} satisfies WebExtension;
