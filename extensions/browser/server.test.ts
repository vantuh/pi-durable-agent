import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeUrl } from "./lib/urls.ts";
import { viewportFrom } from "./lib/viewport.ts";

void describe("browser addresses", () => {
    void it("opens local servers over http and other hosts over https", () => {
        assert.equal(normalizeUrl("localhost:5173"), "http://localhost:5173/");
        assert.equal(normalizeUrl("example.com"), "https://example.com/");
    });

    void it("refuses schemes that run code or reach the browser itself", () => {
        assert.equal(normalizeUrl("javascript:alert(1)"), undefined);
        assert.equal(normalizeUrl("chrome://settings"), undefined);
    });

    void it("opens files only when trusted", () => {
        assert.equal(normalizeUrl("/etc/hosts"), undefined);
        assert.equal(normalizeUrl("/etc/hosts", { trusted: true, cwd: "/" }), "file:///etc/hosts");
    });
});

void describe("browser viewports", () => {
    void it("reads presets and WIDTHxHEIGHT, and clamps sizes", () => {
        assert.equal(viewportFrom("mobile")?.width, 390);
        assert.deepEqual(viewportFrom("1024x768"), {
            width: 1024,
            height: 768,
            scale: 1,
            mobile: false,
        });
        assert.equal(viewportFrom("9999x9999")?.width, 3840);
        assert.equal(viewportFrom("huge"), undefined);
    });
});
