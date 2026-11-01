import type { SessionSummary } from "../../../shared/protocol.ts";

/** One folder of the sidebar's folder menu, with the folders shown under it. */
export type FolderRow = {
    cwd: string;
    /** The folder this one is shown under; null for a root. */
    under: string | null;
    /** Its own sessions plus every worktree's. */
    count: number;
    /** The newest `activeAt` among them, so a folder rises when one of its worktrees was worked in. */
    lastUse: number;
    /** In the order they are drawn. */
    worktrees: FolderRow[];
};

/**
 * The folders sessions work in, worked in last first. A folder that a session says it belongs under
 * is nested there when that folder has sessions of its own; otherwise it stays a root.
 */
export function folderRows(sessions: readonly SessionSummary[]): FolderRow[] {
    const own = new Map<string, { count: number; lastUse: number }>();
    const claimed = new Map<string, string>();

    for (const session of sessions) {
        if (session.cwd === null) {
            continue;
        }

        const bucket = own.get(session.cwd) ?? { count: 0, lastUse: 0 };

        own.set(session.cwd, {
            count: bucket.count + 1,
            lastUse: Math.max(bucket.lastUse, session.activeAt ?? 0),
        });
        if (session.under !== undefined && !claimed.has(session.cwd)) {
            claimed.set(session.cwd, session.under);
        }
    }

    const parentOf = (cwd: string): string | undefined => {
        const under = claimed.get(cwd);

        return under !== undefined && under !== cwd && own.has(under) ? under : undefined;
    };
    // A folder that would end up under itself is a root, so no loop hides a folder from the menu.
    const loops = (cwd: string): boolean => {
        const seen = new Set<string>();

        for (let at = parentOf(cwd); at !== undefined && !seen.has(at); at = parentOf(at)) {
            if (at === cwd) {
                return true;
            }
            seen.add(at);
        }

        return false;
    };
    const children = new Map<string, string[]>();
    const roots: string[] = [];

    for (const cwd of own.keys()) {
        const parent = loops(cwd) ? undefined : parentOf(cwd);

        if (parent === undefined) {
            roots.push(cwd);
        } else {
            children.set(parent, [...(children.get(parent) ?? []), cwd]);
        }
    }

    const build = (cwd: string, under: string | null): FolderRow => {
        const worktrees = (children.get(cwd) ?? []).map((child) => build(child, cwd));
        const bucket = own.get(cwd);

        return {
            cwd,
            under,
            count: (bucket?.count ?? 0) + worktrees.reduce((sum, row) => sum + row.count, 0),
            lastUse: Math.max(bucket?.lastUse ?? 0, ...worktrees.map((row) => row.lastUse)),
            worktrees: worktrees.toSorted(byLastUse),
        };
    };

    return roots.map((cwd) => build(cwd, null)).toSorted(byLastUse);
}

// The path breaks ties, so equal times do not swap rows.
function byLastUse(left: FolderRow, right: FolderRow): number {
    return right.lastUse - left.lastUse || left.cwd.localeCompare(right.cwd);
}

/** The row's own folder and every worktree's, depth first. */
export function cwdsOf(row: FolderRow): string[] {
    return [row.cwd, ...row.worktrees.flatMap(cwdsOf)];
}

/** The row for `cwd` at any depth, or undefined when no row is for it. */
export function rowOf(rows: readonly FolderRow[], cwd: string | null): FolderRow | undefined {
    for (const row of rows) {
        if (row.cwd === cwd) {
            return row;
        }

        const found = rowOf(row.worktrees, cwd);

        if (found !== undefined) {
            return found;
        }
    }

    return undefined;
}
