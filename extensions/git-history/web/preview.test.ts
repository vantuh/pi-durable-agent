import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";

import { findChromium, withBrowserApp } from "../../../test/fixtures/browser.ts";

const ROOTS = `[...document.querySelectorAll("diffs-container")].map((host) => host.shadowRoot).filter(Boolean)`;
const EDIT = `document.querySelector("#edit diffs-container")?.shadowRoot`;
const HISTORY = `[...document.querySelectorAll("#history diffs-container")].map((host) => host.shadowRoot).filter(Boolean)`;

void it("renders edit cards and a virtualized list with one theme and responsive shared layout", async (t) => {
    const found = await findChromium(t);
    if (found === undefined) {
        return;
    }
    await withBrowserApp(
        found,
        (_request, response) => {
            response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>
<html data-flavour="mocha"><body><div id="root"></div><script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
localStorage.setItem("diff-layout", "split");
await import(${JSON.stringify(`/@fs/${resolve("extensions/git-history/web/fixtures/diff-page.tsx")}`)});
</script></body></html>`);
        },
        async (page) => {
            await page.send("Emulation.setDeviceMetricsOverride", {
                width: 390,
                height: 900,
                deviceScaleFactor: 1,
                mobile: false,
            });
            await page.open("/api/diff-fixture");
            assert.ok(
                await page.until(
                    `${EDIT}?.querySelector('[data-diff-type="single"]') !== null && ${EDIT}?.textContent.includes("нове 😀")`,
                    30_000,
                ),
            );
            assert.ok(
                await page.until(
                    `${HISTORY}.some((root) => root.querySelector('[data-diff-type="single"]'))`,
                    10_000,
                ),
            );
            assert.equal(
                await page.read(`document.querySelector("#broken pre").textContent`),
                "-1 old\nunknown output",
            );
            assert.equal(
                await page.read(`document.querySelector("#cut output").textContent`),
                "… 19 more lines",
            );
            assert.equal(
                await page.read(`document.documentElement.scrollWidth <= innerWidth`),
                true,
            );
            assert.ok(await page.seen(`${EDIT}.querySelector('[data-diff-span]') !== null`));
            assert.ok(
                await page.seen(
                    `${ROOTS}.every((root) => root.querySelector('[data-diff-type="split"]') === null)`,
                ),
            );
            assert.ok(
                await page.seen(
                    `${HISTORY}.reduce((sum, root) => sum + root.querySelectorAll("[data-line]").length, 0) < 1000`,
                ),
            );

            await page.send("Emulation.setDeviceMetricsOverride", {
                width: 1200,
                height: 1000,
                deviceScaleFactor: 1,
                mobile: false,
            });
            assert.ok(
                await page.until(
                    `${EDIT}.querySelector('[data-diff-type="split"]') !== null`,
                    5000,
                ),
            );
            assert.ok(
                await page.until(
                    `${HISTORY}.some((root) => root.querySelector('[data-diff-type="split"]'))`,
                    5000,
                ),
            );
            await page.read(`window.diffFixture.layout("unified")`);
            assert.ok(
                await page.until(
                    `${ROOTS}.every((root) => root.querySelector('[data-diff-type="split"]') === null)`,
                    5000,
                ),
            );
            assert.equal(await page.read(`localStorage.getItem("diff-layout")`), "unified");

            assert.ok(
                await page.until(
                    `${EDIT}.querySelector('[style*="--role-code-keyword"]') !== null && ${HISTORY}.some((root) => root.querySelector('[style*="--role-code-keyword"]'))`,
                    5000,
                ),
            );
            const dark = await page.read(
                `getComputedStyle(${EDIT}.querySelector('[data-line]')).color`,
            );
            await page.read(`document.documentElement.dataset.flavour = "latte"`);
            assert.ok(
                await page.until(
                    `getComputedStyle(${EDIT}.querySelector('[data-line]')).color !== ${JSON.stringify(dark)}`,
                    5000,
                ),
            );
            assert.ok(
                await page.seen(`(() => {
            const roots = [${EDIT}, ...${HISTORY}];
            const keywords = roots.map((root) => root.querySelector('[style*="--role-code-keyword"]')).filter(Boolean);
            return roots.filter((root) => root.querySelector("[data-line]")).every((root) => getComputedStyle(root.querySelector('[data-line]')).fontSize === "12px") && keywords.length >= 2 && keywords.every((token) => getComputedStyle(token).color === getComputedStyle(keywords[0]).color);
        })()`),
            );

            const firstHeader = `document.querySelector("#history diffs-container button[aria-expanded]")`;
            await page.read(`${firstHeader}.click()`);
            assert.ok(
                await page.until(
                    `${firstHeader}.getAttribute("aria-expanded") === "false" && ${firstHeader}.closest("diffs-container").getBoundingClientRect().height <= 36`,
                    5000,
                ),
            );
            await page.read(`${firstHeader}.click()`);
            assert.ok(
                await page.until(
                    `${firstHeader}.getAttribute("aria-expanded") === "true" && ${firstHeader}.closest("diffs-container").getBoundingClientRect().height > 36`,
                    5000,
                ),
            );

            await page.read(
                `document.querySelector('nav[aria-label="Changed files"] button[title="file-29.ts"]').click()`,
            );
            assert.ok(
                await page.until(
                    `${HISTORY}.some((root) => root.host.textContent.includes("file-29.ts") && root.querySelector("[data-line]"))`,
                    5000,
                ),
            );
            assert.ok(
                await page.seen(
                    `${HISTORY}.reduce((sum, root) => sum + root.querySelectorAll("[data-line]").length, 0) < 1000`,
                ),
            );
        },
    );
});
