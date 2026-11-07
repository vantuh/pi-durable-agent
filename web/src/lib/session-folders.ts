import type { SessionSummary } from "../../../shared/protocol.ts";

/** One folder of the sidebar, with the worktree folders shown under it. */
type FolderRow = {
    cwd: string;
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
    const own = new Map<string, number>();
    const claimed = new Map<string, string>();

    for (const session of sessions) {
        if (session.cwd === null) {
            continue;
        }

        own.set(session.cwd, Math.max(own.get(session.cwd) ?? 0, session.activeAt ?? 0));
        if (session.under !== undefined && !claimed.has(session.cwd)) {
            claimed.set(session.cwd, session.under);
        }
    }

    const parentOf = (cwd: string): string | undefined => {
        const under = claimed.get(cwd);

        return under !== undefined && under !== cwd && own.has(under) ? under : undefined;
    };
    // A folder that would end up under itself is a root, so no loop hides a folder from the sidebar.
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

    const build = (cwd: string): FolderRow => {
        const worktrees = (children.get(cwd) ?? []).map(build);

        return {
            cwd,
            lastUse: Math.max(own.get(cwd) ?? 0, ...worktrees.map((row) => row.lastUse)),
            worktrees: worktrees.toSorted(byLastUse),
        };
    };

    return roots.map(build).toSorted(byLastUse);
}

// The path breaks ties, so equal times do not swap rows.
function byLastUse(left: FolderRow, right: FolderRow): number {
    return right.lastUse - left.lastUse || left.cwd.localeCompare(right.cwd);
}

/** The row's own folder and every worktree's, depth first. */
export function cwdsOf(row: FolderRow): string[] {
    return [row.cwd, ...row.worktrees.flatMap(cwdsOf)];
}

/** The group of sessions that have no folder. A path is absolute, so no real folder is named like this. */
export const LOOSE = "no folder";

/** Sessions a folder shows before "more", and the step of each "more". */
export const FOLDER_PAGE = 5;

/** One folder of the sidebar with the sessions it shows; a worktree's sessions sit in its folder's group. */
type FolderGroupData = { cwd: string; sessions: SessionSummary[] };

/**
 * The folders in the order the sidebar draws them: the ones `order` does not name first, worked in last first,
 * then the named ones as saved. A name `order` lists twice, or that no session uses, is skipped.
 */
export function orderedFolders(
    all: readonly SessionSummary[],
    order: readonly string[],
): FolderRow[] {
    const rows = folderRows(all);
    const named = new Set(order);
    const byCwd = new Map(rows.map((row) => [row.cwd, row]));

    return [
        ...rows.filter((row) => !named.has(row.cwd)),
        ...[...named].flatMap((cwd) => byCwd.get(cwd) ?? []),
    ];
}

/**
 * `shown` (filtered, in the order to draw) split by `orderedFolders`. A folder with none of `shown` has no group.
 * Sessions with no folder go last, in the group named `LOOSE`.
 */
export function groupByFolder(
    all: readonly SessionSummary[],
    shown: readonly SessionSummary[],
    order: readonly string[],
): FolderGroupData[] {
    const groups = orderedFolders(all, order).map((row) => {
        const cwds = new Set(cwdsOf(row));

        return {
            cwd: row.cwd,
            sessions: shown.filter((session) => session.cwd !== null && cwds.has(session.cwd)),
        };
    });
    const loose = shown.filter((session) => session.cwd === null);

    return [...groups, { cwd: LOOSE, sessions: loose }].filter(
        (group) => group.sessions.length > 0,
    );
}

/**
 * How many of a folder's sessions are open: the count it was opened to, enough pages to reach the open session
 * (`current`), and all of them while searching, so no hit hides behind "more".
 */
export function openCount(
    sessions: readonly SessionSummary[],
    shown: number,
    current: number | null,
    searching: boolean,
): number {
    if (searching) {
        return sessions.length;
    }

    const at = sessions.findIndex((session) => session.id === current);

    return Math.max(shown, at === -1 ? 0 : Math.ceil((at + 1) / FOLDER_PAGE) * FOLDER_PAGE);
}
