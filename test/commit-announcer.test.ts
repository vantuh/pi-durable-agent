import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commitAnnouncer } from "../server/commit-announcer.ts";
import type { CommitView } from "../server/extensions.ts";

void describe("commitAnnouncer", () => {
    void it("keeps each commit's busy value while the cwd is still loading", async () => {
        const seen: CommitView[] = [];
        let resolve: (cwd: string) => void = () => undefined;
        const announce = commitAnnouncer({
            cwdOf: () =>
                new Promise((done) => {
                    resolve = done;
                }),
            ownerOf: () => Promise.resolve(undefined),
            publish: (view) => seen.push(view),
        });

        const first = announce(1, [], true);
        const second = announce(1, [], false);

        resolve("/work");
        await Promise.all([first, second]);

        assert.deepEqual(
            seen.map((view) => [view.busy, view.session.cwd]),
            [
                [true, "/work"],
                [false, "/work"],
            ],
        );
    });

    void it("names the owner of a session that something else started, and only then", async () => {
        const seen: CommitView[] = [];
        const announce = commitAnnouncer({
            cwdOf: () => Promise.resolve("/work"),
            ownerOf: (session) => Promise.resolve(session === 2 ? 1 : undefined),
            publish: (view) => seen.push(view),
        });

        await announce(1, [], false);
        await announce(2, [], false);

        assert.deepEqual(
            seen.map((view) => view.session),
            [
                { id: 1, cwd: "/work" },
                { id: 2, cwd: "/work", owner: 1 },
            ],
        );
    });
});
