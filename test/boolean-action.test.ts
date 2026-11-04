// Test: the per-session on/off switch of an extension: stale answers are dropped, saves settle by reading, retries stop.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { parseHTML } from "linkedom";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { actionRef } from "../shared/extension-api.ts";
import { type Switched, useBooleanAction } from "../web/src/sdk/boolean-action.ts";

const parse = (value: unknown): Switched => {
    const on = typeof value === "object" && value !== null ? Reflect.get(value, "on") : undefined;

    if (typeof on !== "boolean") {
        throw new Error("bad state");
    }

    return { on };
};
const stateRef = actionRef<undefined, Switched>("probe", "state", parse);
const setRef = actionRef<{ on: boolean }, Switched>("probe", "set", parse);

/** One call to the server half, held until the test answers it. */
type Held = { action: string; answer: (result: unknown) => void; fail: () => void };

void describe("useBooleanAction", () => {
    let calls: Held[];
    let shown: ReturnType<typeof useBooleanAction> | undefined;
    let root: Root;
    const realFetch = globalThis.fetch;

    const Probe = ({ id }: { id: number | null }): ReactElement | null => {
        const result = useBooleanAction(id, stateRef, setRef);

        useEffect(() => {
            shown = result;
        });

        return null;
    };
    const mount = (id: number | null = 1): void => {
        act(() => {
            root.render(createElement(Probe, { id }));
        });
    };
    const settle = async (): Promise<void> => {
        await act(async () => {
            for (let turn = 0; turn < 5; turn += 1) {
                await Promise.resolve();
            }
        });
    };
    const answer = async (held: Held | undefined, on: boolean): Promise<void> => {
        assert.ok(held);
        held.answer({ on });
        await settle();
    };
    const callsTo = (action: string): Held[] => calls.filter((held) => held.action === action);

    beforeEach(() => {
        const { document, window } = parseHTML("<!doctype html><html><body></body></html>");

        Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
        calls = [];
        shown = undefined;
        mock.timers.enable({ apis: ["setTimeout"] });
        globalThis.fetch = (input) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const action = url.split("/").at(-1) ?? "";

            return new Promise((resolve) => {
                calls.push({
                    action,
                    answer: (result) => {
                        resolve(Response.json({ result }));
                    },
                    fail: () => {
                        resolve(new Response("{}", { status: 500 }));
                    },
                });
            });
        };
        root = createRoot(document.createElement("div"));
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        mock.timers.reset();
        globalThis.fetch = realFetch;
    });

    void it("shows what the server holds once it answers, and nothing before", async () => {
        mount();

        assert.equal(shown?.mode, null);

        await answer(calls[0], true);

        assert.deepEqual(shown?.mode, { on: true });
    });

    void it("drops a reading that was overtaken by a toggle, and settles on the server's value", async () => {
        mount();
        await answer(calls[0], false);

        // A reading is in flight when the toggle is made, and its answer arrives last.
        act(() => {
            void shown?.read();
        });

        const slow = callsTo("state")[1];

        act(() => {
            shown?.toggle(true);
        });
        await answer(callsTo("set")[0], true);
        assert.deepEqual(shown?.mode, { on: true });

        const reread = callsTo("state")[2];

        await answer(slow, false);
        assert.deepEqual(shown?.mode, { on: true }, "the late reading is not shown");

        await answer(reread, true);
        assert.deepEqual(shown?.mode, { on: true });
    });

    void it("ignores a reading that finishes while a save is running", async () => {
        mount();
        await answer(calls[0], false);
        act(() => {
            shown?.toggle(true);
        });
        act(() => {
            void shown?.read();
        });

        // Whatever it read, the save in flight is about to change it.
        await answer(callsTo("state")[1], true);
        assert.deepEqual(shown?.mode, { on: false });

        // The reading outranked the save's own answer, so the value arrives with the reading after it.
        await answer(callsTo("set")[0], true);
        await answer(callsTo("state")[2], true);
        assert.deepEqual(shown?.mode, { on: true });
    });

    void it("reads again after a failed save and keeps the switch as the server holds it", async () => {
        mount();
        await answer(calls[0], true);
        act(() => {
            shown?.toggle(false);
        });
        callsTo("set")[0]?.fail();
        await settle();

        const reread = callsTo("state").at(-1);

        assert.notEqual(reread, calls[0]);
        await answer(reread, true);
        assert.deepEqual(shown?.mode, { on: true });
    });

    void it("tries three times in all when the server never answers, five seconds apart", async () => {
        mount();
        calls[0]?.fail();
        await settle();
        assert.equal(calls.length, 1);

        for (const total of [2, 3]) {
            act(() => {
                mock.timers.tick(5_000);
            });
            assert.equal(calls.length, total);
            calls[total - 1]?.fail();
            await settle();
        }

        act(() => {
            mock.timers.tick(60_000);
        });
        assert.equal(calls.length, 3);
        assert.equal(shown?.mode, null);
    });

    void it("asks nothing without a session, and reads when the session changes", () => {
        mount(null);
        assert.equal(calls.length, 0);

        mount(2);
        assert.equal(callsTo("state").length, 1);
    });
});
