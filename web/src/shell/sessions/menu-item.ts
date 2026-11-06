import type { FolderSessionMenuItem } from "@/extensions.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";

/** An item's label and icon, which a folder may read off the row: pause turns into resume. */
export function labelOf(item: FolderSessionMenuItem, session: SessionSummary): string {
    return typeof item.label === "function" ? item.label(session) : item.label;
}

export const runKey = (item: FolderSessionMenuItem, session: SessionSummary): string =>
    `${String(session.id)}:${item.id}`;
