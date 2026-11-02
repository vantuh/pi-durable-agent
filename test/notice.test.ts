import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { noticeTarget } from "../web/src/lib/notice.ts";

void describe("noticeTarget", () => {
    void it("says a notice about another session as that session's own toast", () => {
        assert.deepEqual(
            noticeTarget(
                {
                    level: "error",
                    message: "Fix the login bug",
                    session: 4,
                    description: "Bash timed out after 1 min · sleep 91 · pi",
                },
                2,
            ),
            {
                kind: "session",
                level: "error",
                session: 4,
                title: "Fix the login bug",
                description: "Bash timed out after 1 min · sleep 91 · pi",
            },
        );
    });

    void it("keeps the session on screen silent, and says a notice without one wherever it lands", () => {
        assert.deepEqual(
            noticeTarget({ level: "error", message: "Fix the login bug", session: 4 }, 4),
            { kind: "silent" },
        );
        assert.deepEqual(
            noticeTarget({ level: "success", message: "Extension “notes” loaded" }, 4),
            { kind: "plain", level: "success", message: "Extension “notes” loaded" },
        );
    });

    void it("leaves out the description a notice does not have", () => {
        assert.deepEqual(
            noticeTarget({ level: "error", message: "Fix the login bug", session: 4 }, null),
            {
                kind: "session",
                level: "error",
                session: 4,
                title: "Fix the login bug",
            },
        );
    });
});
