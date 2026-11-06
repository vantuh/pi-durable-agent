import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strip, type Strip } from "../refs.ts";

const agent = {
    name: "Counter",
    profile: "counter",
    model: "faux/profile",
    session: 2,
    fill: 10,
    used: 100,
    window: 1000,
};

void describe("strip.parse", () => {
    void it("keeps the folder an agent works in, or null when unknown", () => {
        const sent: Strip = {
            parent: null,
            agents: [
                { ...agent, cwd: "/work/tree" },
                { ...agent, session: 3, cwd: null },
            ],
        };

        assert.deepEqual(strip.parse(JSON.parse(JSON.stringify(sent))), sent);
    });

    void it("refuses an agent with no folder field or a folder that is not text", () => {
        for (const cwd of [undefined, 7]) {
            assert.throws(
                () => strip.parse({ parent: null, agents: [{ ...agent, cwd }] }),
                /malformed/,
            );
        }
    });
});
