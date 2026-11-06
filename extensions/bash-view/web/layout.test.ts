import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layout } from "./layout.ts";

void describe("layout", () => {
    void it("puts each statement on its own line and each && part under the first", () => {
        assert.equal(
            layout(
                'pnpm check > /tmp/check.log 2>&1 && pnpm test > /tmp/test.log 2>&1; result=$?; tail -n 12 /tmp/check.log; exit "$result"',
            ),
            [
                "pnpm check > /tmp/check.log 2>&1 &&",
                "  pnpm test > /tmp/test.log 2>&1",
                "result=$?",
                "tail -n 12 /tmp/check.log",
                'exit "$result"',
            ].join("\n"),
        );
    });

    void it("indents a long pipeline inside a chain one level deeper, and leaves a short one whole", () => {
        assert.equal(
            layout(
                "cd /x && git log --oneline --since=yesterday | grep -v fixup | head -30 || echo none; ls | wc -l",
            ),
            [
                "cd /x &&",
                "  git log --oneline --since=yesterday |",
                "    grep -v fixup |",
                "    head -30 ||",
                "  echo none",
                "ls | wc -l",
            ].join("\n"),
        );
    });

    void it("keeps a negation, a background job and words that only look like operators", () => {
        assert.equal(
            layout(
                'sleep 1 & ! grep -r TODO src --include="*.ts" | grep -v node_modules | wc -l; echo "a && b; c | d"',
            ),
            [
                "sleep 1 &",
                '! grep -r TODO src --include="*.ts" |',
                "  grep -v node_modules |",
                "  wc -l",
                'echo "a && b; c | d"',
            ].join("\n"),
        );
    });

    void it("keeps comments, a paragraph break and a statement written over several lines", () => {
        const script = "#!/bin/bash\nset -e # strict\n\nif true; then\n  echo a\nfi";

        assert.equal(
            layout(script),
            ["#!/bin/bash", "set -e", "# strict", "", "if true; then\n  echo a\nfi"].join("\n"),
        );
    });

    void it("leaves a heredoc and a command that does not parse as written", () => {
        const heredoc = "cat > f <<'EOF' && echo ok\nbody\nEOF";

        assert.equal(layout(heredoc), heredoc);
        assert.equal(layout('echo "open && b'), 'echo "open && b');
    });
});
