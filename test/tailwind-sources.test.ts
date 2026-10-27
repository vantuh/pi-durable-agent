import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";

const STYLES = new URL("../web/src/styles/styles.css", import.meta.url).pathname;

void describe("tailwind sources", () => {
    // `@source` is relative to the CSS file, so moving the file breaks it without any error:
    // the utility classes of everything it scanned simply stop being generated.
    void it("point at folders that exist, so no scanned file loses its classes", () => {
        const sources = [...readFileSync(STYLES, "utf8").matchAll(/@source\s+"([^"]+)"/g)].map(
            (match) => match[1] ?? "",
        );

        assert.ok(sources.length > 0, "styles.css scans something");

        for (const source of sources) {
            assert.ok(existsSync(resolve(dirname(STYLES), source)), `${source} exists`);
        }
    });
});
