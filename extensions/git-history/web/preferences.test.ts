import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";

import { startVite } from "../../../test/fixtures/vite.ts";
import {
    applyDiffLayout,
    currentDiffLayout,
    watchDiffLayout,
} from "../../../web/src/lib/diff-layout.ts";

void it("shares layout changes and migrates history's choice only when Appearance has none", async () => {
    const values = new Map<string, string>();
    Object.assign(globalThis, { window: new EventTarget() });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        },
    });
    const { vite, stop } = await startVite("custom");
    let notifications = 0;
    const unwatch = watchDiffLayout(() => {
        notifications += 1;
    });

    try {
        for (const [index, saved, previous, expected] of [
            [0, undefined, "split", "split"],
            [1, "unified", "split", "unified"],
            [2, "split", "unified", "split"],
            [3, undefined, "invalid", "unified"],
        ] as const) {
            values.clear();
            if (saved !== undefined) {
                values.set("diff-layout", saved);
            }
            values.set("git-history:diff-style", previous);
            await vite.ssrLoadModule(
                `${resolve("extensions/git-history/web/preferences.ts")}?case=${String(index)}`,
            );
            assert.equal(currentDiffLayout(), expected);
            assert.equal(values.get("git-history:diff-style"), previous);
        }
        assert.equal(notifications, 1);
        applyDiffLayout("split");
        assert.equal(currentDiffLayout(), "split");
        assert.equal(notifications, 2);
        window.dispatchEvent(new Event("storage"));
        assert.equal(notifications, 3);
        unwatch();
        applyDiffLayout("unified");
        assert.equal(notifications, 3);
    } finally {
        unwatch();
        await stop();
    }
});
