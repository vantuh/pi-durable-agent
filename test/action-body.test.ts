import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ActionBody } from "../server/routes/extensions.ts";

// `jsonBody` reads an empty body as `{}` (test/validate.test.ts), so `{}` stands for "nothing sent" here.
void describe("ActionBody", () => {
    void it("takes an object with an optional session and any args", () => {
        assert.deepEqual(ActionBody.parse({}), {});
        assert.deepEqual(ActionBody.parse({ session: 3, args: { a: 1 } }), {
            session: 3,
            args: { a: 1 },
        });
        assert.equal(ActionBody.parse({ session: 3 }).args, undefined);
    });

    void it("refuses what is not an object, and a session that is not a positive integer", () => {
        for (const bad of [
            [],
            "x",
            5,
            null,
            { session: 0 },
            { session: -1 },
            { session: 1.5 },
            { session: "1" },
            { session: null },
        ]) {
            assert.equal(ActionBody.safeParse(bad).success, false, JSON.stringify(bad));
        }
    });
});
