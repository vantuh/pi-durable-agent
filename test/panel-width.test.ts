import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampPanelWidth } from "../web/src/lib/panel-width.ts";

void describe("clampPanelWidth", () => {
    void it("keeps the width between 320 and 1100", () => {
        assert.equal(clampPanelWidth(900), 900);
        assert.equal(clampPanelWidth(5000), 1100);
        assert.equal(clampPanelWidth(100), 320);
    });
});
