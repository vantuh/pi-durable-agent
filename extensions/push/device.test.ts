import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enable, OLD_WORKER, type EnableParts } from "./device.ts";

function parts(over: Partial<EnableParts>): EnableParts {
    return {
        notification: { permission: "default", requestPermission: () => Promise.resolve("denied") },
        registration: undefined,
        ready: () => Promise.reject(new Error("not reached")),
        prepare: () => Promise.reject(new Error("not reached")),
        save: () => Promise.reject(new Error("not reached")),
        ...over,
    };
}

// A registration with only what the check reads.
const waiting = { waiting: {}, installing: null };
const installing = { waiting: null, installing: {} };

void describe("push enable", () => {
    void it("asks for permission before the first await, which keeps the user gesture", () => {
        let asked = false;
        const pending = enable(
            "me@example.com",
            parts({
                notification: {
                    permission: "default",
                    requestPermission: () => {
                        asked = true;

                        return Promise.resolve("denied");
                    },
                },
            }),
        );

        // No await has run yet: the call returned a promise, and the prompt was already requested.
        assert.equal(asked, true);

        return assert.rejects(pending, /not allowed/);
    });

    void it("refuses while an update waits, before it asks for permission", async () => {
        let asked = false;
        const notification = {
            permission: "default" as const,
            requestPermission: () => {
                asked = true;

                return Promise.resolve("granted");
            },
        };

        await assert.rejects(
            enable(
                "me@example.com",
                parts({
                    notification,
                    registration: waiting,
                }),
            ),
            new RegExp(OLD_WORKER.slice(0, 20)),
        );
        await assert.rejects(
            enable(
                "me@example.com",
                parts({
                    notification,
                    registration: installing,
                }),
            ),
            /still installing/,
        );
        assert.equal(asked, false);
    });

    void it("refuses a bad contact before it asks for permission", async () => {
        let asked = false;

        await assert.rejects(
            enable(
                "nope",
                parts({
                    notification: {
                        permission: "default",
                        requestPermission: () => {
                            asked = true;

                            return Promise.resolve("granted");
                        },
                    },
                }),
            ),
        );
        assert.equal(asked, false);
    });
});
