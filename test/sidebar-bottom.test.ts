import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    areaLimits,
    clampArea,
    heightForKey,
    NARROW,
    WIDE,
} from "../web/src/lib/sidebar-bottom.ts";

void describe("areaLimits", () => {
    void it("leaves the list its minimum, and the handle its height", () => {
        // 400 shared - 10 handle - 148 list
        assert.deepEqual(areaLimits(400, WIDE), { min: 96, max: 242 });
        assert.deepEqual(areaLimits(400, NARROW), { min: 120, max: 224 });
    });

    void it("never puts the maximum under the minimum when the sidebar is short", () => {
        assert.deepEqual(areaLimits(200, WIDE), { min: 96, max: 96 });
    });
});

void describe("clampArea", () => {
    void it("rounds and keeps the height between the limits", () => {
        const limits = { min: 96, max: 242 };

        assert.equal(clampArea(150.4, limits), 150);
        assert.equal(clampArea(10, limits), 96);
        assert.equal(clampArea(900, limits), 242);
    });
});

void describe("heightForKey", () => {
    const limits = { min: 96, max: 242 };

    void it("moves by 16, or 64 with Shift; Up grows the area", () => {
        assert.equal(heightForKey("ArrowUp", false, 128, limits), 144);
        assert.equal(heightForKey("ArrowDown", false, 128, limits), 112);
        assert.equal(heightForKey("ArrowUp", true, 128, limits), 192);
    });

    void it("stops at the limits", () => {
        assert.equal(heightForKey("ArrowUp", true, 230, limits), 242);
        assert.equal(heightForKey("ArrowDown", true, 100, limits), 96);
    });

    void it("jumps to a limit with Home and End", () => {
        assert.equal(heightForKey("Home", false, 150, limits), 96);
        assert.equal(heightForKey("End", false, 150, limits), 242);
    });

    void it("leaves other keys alone", () => {
        assert.equal(heightForKey("Enter", false, 150, limits), null);
        assert.equal(heightForKey("a", false, 150, limits), null);
    });
});
