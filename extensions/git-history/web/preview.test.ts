import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";

import { findChromium, withBrowserApp } from "../../../test/fixtures/browser.ts";

const ROOTS = `[...document.querySelectorAll("diffs-container")].map((host) => host.shadowRoot).filter(Boolean)`;
const EDIT = `document.querySelector("#edit diffs-container")?.shadowRoot`;
const HISTORY = `[...document.querySelectorAll("#history diffs-container")].map((host) => host.shadowRoot).filter(Boolean)`;
const TREE = `document.querySelector('#history file-tree-container').shadowRoot`;

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
            assert.equal(await page.read("window.diffFixture.highlighter()"), "highlights");
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

            assert.ok(
                await page.seen(
                    `document.querySelector('#history button[aria-label="Resize file tree"]').getClientRects().length === 0`,
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

            const resizeTree = `document.querySelector('#history button[aria-label="Resize file tree"]')`;
            const treeBox = `document.querySelector('#history file-tree-container').closest('nav').parentElement`;
            assert.ok(await page.until(`${resizeTree} !== null`, 5000));
            assert.ok(
                await page.seen(
                    `${TREE}.querySelector('[data-item-path]') !== null && ${treeBox}.getBoundingClientRect().width === 240`,
                ),
            );
            await page.read(`${resizeTree}.focus()`);
            for (const type of ["keyDown", "keyUp"]) {
                await page.send("Input.dispatchKeyEvent", {
                    type,
                    key: "ArrowRight",
                    code: "ArrowRight",
                    windowsVirtualKeyCode: 39,
                });
            }
            assert.ok(await page.until(`${treeBox}.getBoundingClientRect().width === 256`, 5000));
            assert.equal(await page.read(`localStorage.getItem('git-history:tree-width')`), "256");
            await page.read(
                `${resizeTree}.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`,
            );
            assert.ok(await page.until(`${treeBox}.getBoundingClientRect().width === 240`, 5000));
            assert.equal(await page.read(`localStorage.getItem('git-history:tree-width')`), null);

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

            await page.read(`(() => {
                const scroll = ${TREE}.querySelector('[data-file-tree-virtualized-scroll]');
                scroll.scrollTop = scroll.scrollHeight;
            })()`);
            const lastFile = `${TREE}.querySelector('[data-item-path="file-29.ts"]')`;
            assert.ok(await page.until(`${lastFile} !== null`, 5000));
            await page.read(`${lastFile}.click()`);
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
            const lastHeader = `[...document.querySelectorAll('#history diffs-container button[aria-expanded]')].find((button) => button.textContent.includes('file-29.ts'))`;
            await page.read(`${lastHeader}.click()`);
            assert.ok(
                await page.until(`${lastHeader}.getAttribute('aria-expanded') === 'false'`, 5000),
            );
            await page.read(`${lastFile}.click()`);
            assert.ok(
                await page.until(`${lastHeader}.getAttribute('aria-expanded') === 'true'`, 5000),
            );
            assert.equal(
                await page.read(`${lastHeader}.querySelector('svg use').getAttribute('href')`),
                "#file-tree-builtin-typescript",
            );
            assert.ok(
                await page.seen(`${lastHeader}.querySelector('svg:has(use)').getBBox().width > 0`),
            );
            assert.ok(
                await page.seen(`(() => {
                const header = getComputedStyle(${lastHeader}.querySelector('svg:has(use)')).color;
                const tree = getComputedStyle(${TREE}.querySelector('[data-icon-token="typescript"]')).color;
                return header === tree && header !== getComputedStyle(${lastHeader}).color;
            })()`),
            );

            // ScrollArea draws its bar over CodeView's own scroller: no native bar, and the thumb follows scrollTop.
            // A wide code block scrolls sideways in the themed area; its bar sits under the last line.
            const wideBar = `document.querySelector("#wide [data-orientation=horizontal]")`;
            const wideScroller = `document.querySelector("#wide [data-radix-scroll-area-viewport]")`;
            assert.equal(
                await page.read(
                    `${wideScroller}.scrollWidth > ${wideScroller}.clientWidth && ${wideScroller}.offsetHeight === ${wideScroller}.clientHeight`,
                ),
                true,
            );
            await page.read(`document.querySelector("#wide").scrollIntoView({ block: "center" })`);
            const wideBox = `document.querySelector("#wide").getBoundingClientRect()`;
            await page.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: Number(await page.read(`${wideBox}.left + 60`)),
                y: Number(await page.read(`${wideBox}.top + 60`)),
            });
            assert.ok(await page.until(`${wideBar} !== null`, 5000));
            assert.equal(
                await page.read(
                    `${wideBar}.getBoundingClientRect().top >= document.querySelector("#wide pre").getBoundingClientRect().bottom - 8`,
                ),
                true,
            );
            // The commit list scrolls in the same themed area: bar present with no hover, no native one.
            const listBar = `document.querySelector("#list [data-orientation=vertical]")`;
            const listScroller = `${listBar}.parentElement.querySelector("[style*='overflow']")`;
            assert.ok(await page.until(`${listBar} !== null`, 5000));
            assert.equal(
                await page.read(
                    `${listScroller}.scrollHeight > ${listScroller}.clientHeight && ${listScroller}.offsetWidth === ${listScroller}.clientWidth`,
                ),
                true,
            );
            // Over the file tree, away from the diff: the bar stays where it is.
            await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 500 });
            await new Promise((done) => setTimeout(done, 1000));
            const bar = `document.querySelector("#history [data-orientation=vertical]")`;
            assert.ok(await page.until(`${bar} !== null`, 5000));
            const scroller = `${bar}.parentElement.querySelector(".leading-diff")`;
            const thumbTop = `new DOMMatrix(getComputedStyle(${bar}.firstElementChild).transform).m42`;
            assert.equal(
                await page.read(`${scroller}.offsetWidth === ${scroller}.clientWidth`),
                true,
            );
            const before = Number(await page.read(thumbTop));
            assert.ok(before > 0);
            await page.read(`${scroller}.scrollTop = 1e9`);
            assert.ok(await page.until(`${thumbTop} > ${String(before)}`, 5000));
        },
    );
});
