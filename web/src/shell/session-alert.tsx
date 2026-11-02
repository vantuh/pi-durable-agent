import type { SessionNotice } from "../lib/notice.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { toast } from "../lib/toast.ts";

export type SessionAlert = {
    /** Repeats replace each other; absent stacks, so two of the same kind stay two toasts. */
    id?: string;
    level: SessionNotice["level"];
    session: number;
    title: string;
    description?: string;
};

/** Ids of alerts with none of their own: two timeouts of the same command must stay two toasts. */
let alerts = 0;

/**
 * One session's toast at the top right: the title links to the session, and a plain click anywhere on
 * the toast goes there without the page loading again.
 */
export function showSessionAlert(alert: SessionAlert, onOpen: (session: number) => void): void {
    const { level, session, title, description } = alert;
    // Always named: dismissing an unnamed toast would dismiss every toast on the screen.
    const id = alert.id ?? `session-alert-${String((alerts += 1))}`;

    toast[level](
        <a
            href={sessionHref(session)}
            onClick={(event) => {
                if (isPlainClick(event)) {
                    event.preventDefault();
                    toast.dismiss(id);
                    onOpen(session);
                }
            }}
            className="block truncate after:absolute after:inset-0 after:content-['']"
        >
            {title}
        </a>,
        {
            id,
            position: "top-right",
            duration: 6000,
            ...(description === undefined ? {} : { description }),
        },
    );
}
