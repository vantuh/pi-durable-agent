import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { embedded } from "./embedded.ts";

function codeOf(source: string) {
    return embedded(source).map(({ pos, end, lang }) => ({ code: source.slice(pos, end), lang }));
}

void describe("embedded interpreter code", () => {
    void it("extracts Python and JavaScript from chains without shell quotes", () => {
        const source = `cd /tmp && python3 -u -c 'print("hi")' > out; node --eval 'console.log(1)'`;

        assert.deepEqual(codeOf(source), [
            { code: 'print("hi")', lang: "python" },
            { code: "console.log(1)", lang: "javascript" },
        ]);
        assert.deepEqual(codeOf(`/usr/bin/python -c 'print(1)'`), [
            { code: "print(1)", lang: "python" },
        ]);
    });

    void it("keeps shell escapes and concatenated words in their source spelling", () => {
        assert.deepEqual(codeOf('node -e "const x = \\"hi\\"; console.log(x)"'), [
            { code: String.raw`const x = \"hi\"; console.log(x)`, lang: "javascript" },
        ]);
        assert.deepEqual(codeOf(String.raw`python3 -c 'print('\''hi'\'')'`), [
            { code: String.raw`'print('\''hi'\'')'`, lang: "python" },
        ]);
    });

    void it("keeps multiline code and accepts known interpreter options", () => {
        assert.deepEqual(codeOf(`node --input-type=module -e 'const n = 1;\nconsole.log(n)'`), [
            { code: "const n = 1;\nconsole.log(n)", lang: "javascript" },
        ]);
    });

    void it("extracts quoted stdin heredocs, including literal shell expansion characters", () => {
        const source = `python3 - <<'PY' > out\nprint('$HOME')\nPY\nnode <<"JS"\nconsole.log(1)\nJS`;

        assert.deepEqual(codeOf(source), [
            { code: "print('$HOME')\n", lang: "python" },
            { code: "console.log(1)\n", lang: "javascript" },
        ]);
    });

    void it("keeps heredoc tabs intact, including <<-", () => {
        assert.deepEqual(codeOf("node 0<<JS\nconsole.log(1)\nJS"), [
            { code: "console.log(1)\n", lang: "javascript" },
        ]);
        assert.deepEqual(codeOf("python3 <<-'PY'\n\tprint(1)\n\tPY"), [
            { code: "\tprint(1)\n", lang: "python" },
        ]);
        assert.deepEqual(codeOf("python3 <<'PY'\n\tprint(1)\nPY"), [
            { code: "\tprint(1)\n", lang: "python" },
        ]);
    });

    void it("leaves dynamic code, unsupported invocations and incomplete input alone", () => {
        for (const source of [
            'python3 -c "$CODE"',
            "node -e \"console.log('$HOME')\"",
            'node -e "$(cat script.js)"',
            'node -e "`cat script.js`"',
            "\"$RUNTIME\" -e 'console.log(1)'",
            'eval "$CODE"',
            "echo python3 -c 'print(1)'",
            "python3 script.py -c 'not code'",
            "node script.js --eval 'not code'",
            "python3 -m module <<'PY'\nnot code\nPY",
            "node script.js <<'JS'\nnot code\nJS",
            "node <<JS\nconsole.log('$HOME')\nJS",
            String.raw`node <<JS
console.log('\$HOME')
JS`,
            "python3 3<<'PY'\nprint(1)\nPY",
            "python3 <<'PY' < input.py\nprint(1)\nPY",
            "node <<'JS' <<'OTHER'\nconsole.log(1)\nJS\nconsole.log(2)\nOTHER",
            "node -e",
            "python3 -c 'open",
            "node <<'JS'\nconsole.log(1)",
        ]) {
            assert.deepEqual(codeOf(source), [], source);
        }
    });
});
