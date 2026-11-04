import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodingWeights } from "../server/http.ts";

void describe("encodingWeights", () => {
    void it("weighs a coding by its own q, else the wildcard's, else 0", () => {
        const cases: [string | undefined, Record<string, number>][] = [
            [undefined, { br: 0, gzip: 0 }],
            ["", { br: 0, gzip: 0 }],
            ["identity", { br: 0, gzip: 0 }],
            ["gzip, br", { br: 1, gzip: 1 }],
            ["br;q=0, gzip;q=0.5", { br: 0, gzip: 0.5 }],
            ["GZIP ; Q = 0.2", { br: 0, gzip: 0.2 }],
            ["*", { br: 1, gzip: 1 }],
            ["*;q=0", { br: 0, gzip: 0 }],
            ["gzip;q=0, *", { br: 1, gzip: 0 }],
            ["br, *;q=0", { br: 1, gzip: 0 }],
        ];

        for (const [header, expected] of cases) {
            const weight = encodingWeights(header);

            for (const [coding, value] of Object.entries(expected)) {
                assert.equal(weight(coding), value, `${String(header)} -> ${coding}`);
            }
        }
    });
});
