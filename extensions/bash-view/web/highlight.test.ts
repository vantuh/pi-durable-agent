import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";

import { startVite } from "../../../test/fixtures/vite.ts";
import type { tokensOf } from "../../../web/src/lib/highlight.ts";

void it("mixes Bash, Python and JavaScript tokens without changing source text or offsets", async () => {
    const { vite, stop } = await startVite("custom", { optimizeDeps: { noDiscovery: true } });

    try {
        const { commandTokens } = await vite.ssrLoadModule(
            resolve("extensions/bash-view/web/highlight.ts"),
        );
        const source = `printf before; python3 -c 'import os; print("π")'; node <<'JS'\nconst n = 1;\n\nconsole.log(n);\nJS\nprintf after`;
        const lines: Awaited<ReturnType<typeof tokensOf>> = await commandTokens(source);

        assert.ok(lines);
        assert.equal(
            lines.map((line) => line.map((token) => token.content).join("")).join("\n"),
            source,
        );

        for (const token of lines.flat()) {
            assert.equal(
                token.content,
                source.slice(token.offset, token.offset + token.content.length),
            );
        }

        for (const word of ["import", "const"]) {
            assert.ok(
                lines
                    .flat()
                    .some(
                        (token) =>
                            token.content.trim() === word &&
                            token.color === "var(--role-code-keyword)",
                    ),
                word,
            );
        }

        const plain: Awaited<ReturnType<typeof tokensOf>> =
            await commandTokens("echo 'const n = 1'");

        assert.ok(
            !plain
                ?.flat()
                .some(
                    (token) =>
                        token.content.trim() === "const" &&
                        token.color === "var(--role-code-keyword)",
                ),
        );
    } finally {
        await stop();
    }
});
