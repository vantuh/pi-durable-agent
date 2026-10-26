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
});
