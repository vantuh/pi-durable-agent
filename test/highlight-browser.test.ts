import assert from "node:assert/strict";
import { it } from "node:test";

import { findChromium, withBrowserApp } from "./fixtures/browser.ts";

void it("loads the Highlights Wasm engine through Vite in Chromium", async (t) => {
    const found = await findChromium(t);
    if (found === undefined) {
        return;
    }

    await withBrowserApp(
        found,
        (_request, response) => {
            response.writeHead(200, { "Content-Type": "text/html" });
            response.end('<!doctype html><div id="root"></div>');
        },
        async (page) => {
            await page.open("/api/highlight-test");
            assert.ok(await page.until('document.getElementById("root") !== null', 5000));
            const source = 'const s = "<script>π 😀</script>";\n// note\n';
            const result = await page.read(`(async () => {
                const { tokensOf, classOf } = await import("/src/lib/highlight.ts");
                const source = ${JSON.stringify(source)};
                const lines = await tokensOf(source, "TS");
                const tokens = lines.flat();
                return {
                    text: lines.map(line => line.map(token => token.content).join("")).join("\\n"),
                    keyword: tokens.find(token => classOf(token) === "text-code-keyword")?.content.trim(),
                    comment: tokens.find(token => classOf(token) === "text-code-comment italic")?.content,
                    offsets: tokens.every(token => source.slice(token.offset, token.offset + token.content.length) === token.content),
                };
            })()`);

            assert.deepEqual(result, {
                text: source,
                keyword: "const",
                comment: "// note",
                offsets: true,
            });
        },
    );
});
