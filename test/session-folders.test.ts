import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { cwdsOf, folderRows, rowOf } from "../web/src/lib/session-folders.ts";

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
            rows.map((row) => [row.cwd, row.under, row.worktrees.map((tree) => tree.cwd)]),
            [[REPO, null, [SIDE]]],
        );
        assert.equal(rowOf(rows, SIDE)?.under, REPO);
    });

    void it("keeps a worktree a root when the folder it belongs under has no sessions", () => {
        const rows = folderRows([session(1, SIDE, { under: REPO })]);

        assert.deepEqual(
            rows.map((row) => [row.cwd, row.under]),
            [[SIDE, null]],
        );
    });

    void it("counts a folder's worktrees' sessions in its own", () => {
        const rows = folderRows([
            session(1, REPO),
            session(2, SIDE, { under: REPO }),
            session(3, SIDE, { under: REPO }),
        ]);

        assert.equal(rows[0]?.count, 3);
        assert.equal(rows[0]?.worktrees[0]?.count, 2);
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
        assert.equal(rowOf(rows, "/nowhere"), undefined);
        assert.equal(rowOf(rows, null), undefined);
    });
});
