import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import {
    cwdsOf,
    folderRows,
    groupByFolder,
    LOOSE,
    openCount,
} from "../web/src/lib/session-folders.ts";

function session(id: number, cwd: string, extra: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title: `Session ${String(id)}`,
        cwd,
        model: null,
        thinkingLevel: null,
        busy: false,
        activeAt: null,
        unseen: false,
        ...extra,
    };
}

const REPO = "/work/repo";
const SIDE = "/data/worktrees/repo/side";

void describe("folderRows", () => {
    void it("shows a worktree under its folder when that folder has sessions", () => {
        const rows = folderRows([session(1, REPO), session(2, SIDE, { under: REPO })]);

        assert.deepEqual(
            rows.map((row) => [row.cwd, row.worktrees.map((tree) => tree.cwd)]),
            [[REPO, [SIDE]]],
        );
    });

    void it("keeps a worktree a root when the folder it belongs under has no sessions", () => {
        const rows = folderRows([session(1, SIDE, { under: REPO })]);

        assert.deepEqual(
            rows.map((row) => row.cwd),
            [SIDE],
        );
    });

    void it("sorts roots by the newest run among them, and worktrees by their own", () => {
        const rows = folderRows([
            session(1, REPO, { activeAt: 10 }),
            session(2, SIDE, { under: REPO, activeAt: 50 }),
            session(3, "/data/worktrees/repo/old", { under: REPO, activeAt: 20 }),
            session(4, "/work/other", { activeAt: 30 }),
        ]);

        assert.deepEqual(
            rows.map((row) => row.cwd),
            [REPO, "/work/other"],
        );
        assert.equal(rows[0]?.lastUse, 50);
        assert.deepEqual(
            rows[0]?.worktrees.map((row) => row.cwd),
            [SIDE, "/data/worktrees/repo/old"],
        );
    });

    void it("breaks equal times by path, and skips sessions without a folder", () => {
        const rows = folderRows([
            session(1, "/b"),
            session(2, "/a"),
            { ...session(3, "/c"), cwd: null },
        ]);

        assert.deepEqual(
            rows.map((row) => row.cwd),
            ["/a", "/b"],
        );
    });

    void it("keeps both folders when two say they belong under each other", () => {
        const rows = folderRows([
            session(1, "/a", { under: "/b" }),
            session(2, "/b", { under: "/a" }),
        ]);

        assert.deepEqual(
            rows.map((row) => row.cwd),
            ["/a", "/b"],
        );
    });
});

void describe("cwdsOf", () => {
    void it("lists the folder and its worktrees", () => {
        const rows = folderRows([session(1, REPO), session(2, SIDE, { under: REPO })]);
        const [root] = rows;

        assert.ok(root);
        assert.deepEqual(cwdsOf(root), [REPO, SIDE]);
    });
});

void describe("groupByFolder", () => {
    const names = (groups: ReturnType<typeof groupByFolder>) => groups.map((group) => group.cwd);
    const all = [
        session(1, "/work/a", { activeAt: 10 }),
        session(2, "/work/b", { activeAt: 30 }),
        session(3, "/work/c", { activeAt: 20 }),
    ];

    void it("puts the folders a saved order does not name first, worked in last first, then the saved ones", () => {
        assert.deepEqual(names(groupByFolder(all, all, ["/work/a"])), [
            "/work/b",
            "/work/c",
            "/work/a",
        ]);
        assert.deepEqual(names(groupByFolder(all, all, ["/work/c", "/work/a", "/work/b"])), [
            "/work/c",
            "/work/a",
            "/work/b",
        ]);
    });

    void it("skips what the order names but no session uses, and a name listed twice", () => {
        assert.deepEqual(names(groupByFolder(all, all, ["/gone", "/work/b", "/work/b"])), [
            "/work/c",
            "/work/a",
            "/work/b",
        ]);
    });

    void it("leaves out a folder with none of the shown sessions", () => {
        assert.deepEqual(
            names(
                groupByFolder(
                    all,
                    all.filter((row) => row.id === 2),
                    [],
                ),
            ),
            ["/work/b"],
        );
    });

    void it("keeps a worktree's sessions in its folder's group", () => {
        const withTree = [session(1, REPO), session(2, SIDE, { under: REPO })];
        const [group] = groupByFolder(withTree, withTree, []);

        assert.deepEqual(
            group?.sessions.map((row) => row.id),
            [1, 2],
        );
    });
});

void describe("openCount", () => {
    const many = Array.from({ length: 12 }, (_, index) => session(index + 1, REPO));

    void it("opens what was asked for, and every page up to the open session", () => {
        assert.equal(openCount(many, 5, null, false), 5);
        assert.equal(openCount(many, 5, 7, false), 10);
        assert.equal(openCount(many, 10, 3, false), 10);
    });

    void it("opens every session while searching", () => {
        assert.equal(openCount(many, 5, null, true), 12);
    });
});

void describe("sessions with no folder", () => {
    void it("go last, in a group named LOOSE", () => {
        const rows = [{ ...session(1, REPO), cwd: null }, session(2, REPO)];

        assert.deepEqual(
            groupByFolder(rows, rows, []).map((group) => group.cwd),
            [REPO, LOOSE],
        );
    });
});
