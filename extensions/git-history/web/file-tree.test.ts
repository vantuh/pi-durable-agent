import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";

import { findChromium, withBrowserApp } from "../../../test/fixtures/browser.ts";

const TREE = `document.querySelector('file-tree-container')?.shadowRoot`;
const folder = `${TREE}.querySelector('[data-item-path="src/"]')`;
const component = `${TREE}.querySelector('[data-item-path="src/demo.tsx"]')`;

void it("keeps tree activation, counts and built-in icons connected after file updates", async (t) => {
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
await import(${JSON.stringify(`/@fs/${resolve("extensions/git-history/web/fixtures/file-tree-page.tsx")}`)});
</script></body></html>`);
        },
        async (page) => {
            await page.open("/api/tree-fixture");
            assert.ok(
                await page.until(`${component}?.textContent.includes('+12 −3') === true`, 15_000),
            );
            assert.equal(
                await page.read(`${component}.querySelector('use').getAttribute('href')`),
                "#file-tree-builtin-react",
            );
            assert.ok(
                await page.seen(`(() => {
                const reference = document.createElement('span');
                reference.className = 'text-agent';
                document.body.append(reference);
                const matches = getComputedStyle(${component}.querySelector('svg')).color === getComputedStyle(reference).color;
                reference.remove();
                return matches;
            })()`),
            );
            await page.read(`${folder}.click()`);
            assert.ok(await page.until(`${component} === null`, 5000));
            assert.equal(await page.read(`document.querySelector('output').textContent`), "[]");
            await page.read(`${folder}.click()`);
            assert.ok(await page.until(`${component} !== null`, 5000));
            await page.read(`${component}.click()`);
            await page.read(`${component}.click()`);
            assert.ok(
                await page.until(
                    `document.querySelector('output').textContent === '["component","component"]'`,
                    5000,
                ),
            );

            await page.read(`${component}.focus()`);
            await page.send("Input.dispatchKeyEvent", {
                type: "keyDown",
                text: "\r",
                key: "Enter",
                code: "Enter",
                windowsVirtualKeyCode: 13,
            });
            await page.send("Input.dispatchKeyEvent", {
                type: "keyUp",
                key: "Enter",
                code: "Enter",
                windowsVirtualKeyCode: 13,
            });
            assert.ok(
                await page.until(
                    `document.querySelector('output').textContent === '["component","component","component"]'`,
                    5000,
                ),
            );

            await page.read(
                `window.replaceTreeFiles([{id:'updated',path:'src/demo.tsx',added:4,deleted:0},{id:'new',path:'new.unknown',added:0,deleted:9}])`,
            );
            assert.ok(
                await page.until(
                    `${component}?.textContent.includes('+4') === true && !${component}.textContent.includes('−3')`,
                    5000,
                ),
            );
            await page.read(`${component}.click()`);
            assert.ok(
                await page.until(
                    `JSON.parse(document.querySelector('output').textContent).at(-1) === 'updated'`,
                    5000,
                ),
            );
            assert.ok(
                await page.seen(`${TREE}.querySelector('[data-item-path="README.md"]') === null`),
            );
            const added = `${TREE}.querySelector('[data-item-path="new.unknown"]')`;
            assert.ok(
                await page.seen(
                    `${added}.textContent.includes('−9') && !${added}.textContent.includes('+0')`,
                ),
            );
            assert.equal(
                await page.read(`${added}.querySelector('use').getAttribute('href')`),
                "#file-tree-builtin-default",
            );
        },
    );
});
