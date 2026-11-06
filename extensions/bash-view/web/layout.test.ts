import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { layout, split } from "./layout.ts";

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

    void it("splits a git chain without changing a multiline commit message", () => {
        const commands = [
            "git add extensions/bash-view/README.md web/src/ui/markdown/code-block.tsx",
            "git diff --cached --check",
            'git commit --amend -m "feat(bash-view): highlight embedded Python and JS" -m "Expose frameless code text in the shared\nrenderer so extensions reuse streaming and copy behavior without\nadding their own code-block frames."',
            "git status --short",
            "git log -1 --format='%h %s'",
        ];
        const source = commands.join(" && ");

        assert.equal(
            layout(source),
            commands
                .map(
                    (command, index) =>
                        `${index === 0 ? "" : "  "}${command}${index < commands.length - 1 ? " &&" : ""}`,
                )
                .join("\n"),
        );
        assert.deepEqual(
            split(source)
                ?.filter((part) => part.kind === "command")
                .map((part) => source.slice(part.pos, part.end)),
            commands,
            "Panels get one command row per git call, with the commit message intact",
        );
    });

    void it("preserves multiline argument values when a chain is laid out", () => {
        const source =
            "printf '%s\\n' 'first line\n  second line' && printf '%s\\n' 'after the quoted argument'";
        const formatted = layout(source);
        const originalRun = spawnSync("bash", ["-c", source], { encoding: "utf8" });
        const formattedRun = spawnSync("bash", ["-c", formatted], { encoding: "utf8" });

        assert.notEqual(formatted, source);
        assert.equal(originalRun.status, 0, originalRun.stderr);
        assert.equal(formattedRun.status, 0, formattedRun.stderr);
        assert.equal(originalRun.stdout, "first line\n  second line\nafter the quoted argument\n");
        assert.equal(formattedRun.stdout, originalRun.stdout);
    });

    void it("keeps physical line breaks and comments between commands", () => {
        const source =
            "printf before &&\n# keep this comment\nprintf '%s\\n' 'first line\nsecond line'";

        assert.equal(layout(source), source);
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

    void it("formats commands around heredocs without moving their headers or bodies", () => {
        const body = "import {parse} from './parser.js';\nconsole.log(parse('echo hi'));";
        const source = `sed -n '260,380p' types.d.ts; cat traversal.d.ts; node --input-type=module <<'JS'\n${body}\nJS\necho done; pwd`;

        assert.equal(
            layout(source),
            `sed -n '260,380p' types.d.ts\ncat traversal.d.ts\nnode --input-type=module <<'JS'\n${body}\nJS\necho done\npwd`,
        );
    });

    void it("keeps statements and multiple heredocs on the same header line together", () => {
        const block = "cat <<'A'; cat <<'B' && echo ready\nfirst\nA\nsecond\nB";

        assert.equal(layout(`pwd; ${block}\nls; date`), `pwd\n${block}\nls\ndate`);
        assert.equal(layout("echo 'a << b'; pwd"), "echo 'a << b'\npwd");
        assert.equal(layout("cat <<< 'hello'; pwd"), "cat <<< 'hello'\npwd");
    });

    void it("keeps heredoc execution unchanged when statements move to separate lines", () => {
        const source = [
            String.raw`printf 'before\n'; cat <<'A'; cat <<-'B' && printf 'after\n'`,
            "first ; && 'quoted'",
            "A",
            "\tsecond",
            "\tB",
            String.raw`printf 'tail\n'; printf 'done\n'`,
        ].join("\n");
        const original = spawnSync("bash", ["-c", source], { encoding: "utf8" });
        const formatted = spawnSync("bash", ["-c", layout(source)], { encoding: "utf8" });

        assert.equal(original.status, 0, original.stderr);
        assert.equal(formatted.status, 0, formatted.stderr);
        assert.equal(original.stdout, "before\nfirst ; && 'quoted'\nsecond\nafter\ntail\ndone\n");
        assert.equal(formatted.stdout, original.stdout);
    });

    void it("leaves a heredoc and a command that does not parse as written", () => {
        const heredoc = "cat > f <<'EOF' && echo ok\nbody\nEOF";

        assert.equal(layout(heredoc), heredoc);
        assert.equal(layout('echo "open && b'), 'echo "open && b');
    });
});
