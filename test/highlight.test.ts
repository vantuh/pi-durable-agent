import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ThemedToken } from "@pierre/highlights";

import { classOf, load, tokensOf } from "../web/src/lib/highlight.ts";

const token = (color: string, fontStyle?: number): ThemedToken => ({
    content: "x",
    offset: 0,
    color,
    ...(fontStyle === undefined ? {} : { fontStyle }),
});

void describe("tokensOf", () => {
    void it("returns lines of tokens for a known language, whatever its case", async () => {
        const lines = await tokensOf("const a = 1;\nlet b;", "TS");

        assert.equal(lines?.length, 2);
        assert.equal(lines?.[0]?.map((each) => each.content).join(""), "const a = 1;");
        assert.ok(lines?.[0]?.some((each) => each.color === "var(--role-code-keyword)"));
    });

    void it("returns undefined for an unknown language or none, so the code stays plain", async () => {
        assert.equal(await tokensOf("hello", "not-a-language"), undefined);
        assert.equal(await tokensOf("hello", "constructor"), undefined);
        assert.equal(await tokensOf("hello", ""), undefined);
        assert.equal(await tokensOf("\u001b[31mhello", "ansi"), undefined);
    });

    void it("preserves Unicode, blank lines, trailing newlines and UTF-16 source offsets", async () => {
        for (const source of [
            "",
            "\n",
            '// 😀 ї\n\nconst s = "π";\n',
            '// 😀\r\nconst s = "ї";\r\n',
        ]) {
            const lines = await tokensOf(source, "ts");

            assert.ok(lines);
            assert.equal(
                lines.map((line) => line.map((each) => each.content).join("")).join("\n"),
                source.replaceAll("\r\n", "\n"),
            );

            for (const each of lines.flat()) {
                assert.equal(
                    each.content,
                    source.slice(each.offset, each.offset + each.content.length),
                );
            }
        }
    });

    void it("uses only theme roles across code blocks, files and shell languages", async () => {
        for (const [lang, source] of [
            [
                "tsx",
                'export const View = ({ name }: { name: string }) => <div title="x">{name}</div>;',
            ],
            ["python", '# note\nimport os\nprint("π", True, 42)'],
            ["bash", 'git status && echo "$HOME" # note'],
            ["json", '{"ok": true, "count": 42}'],
            ["css", "body { display: flex; } /* note */"],
            ["html", '<a href="/">link</a>'],
            ["yaml", "name: test\nenabled: true"],
            ["sql", "SELECT * FROM users WHERE id = 1;"],
            ["diff", "+added\n-removed"],
        ]) {
            assert.ok(lang !== undefined && source !== undefined);
            const lines = await tokensOf(source, lang);

            assert.ok(lines, lang);
            assert.equal(
                lines.map((line) => line.map((each) => each.content).join("")).join("\n"),
                source,
            );
            assert.ok(
                lines.flat().some((each) => classOf(each) !== "text-ink"),
                lang,
            );

            for (const each of lines.flat()) {
                const color = each.color ?? "";
                assert.match(color, /^var\(--role-[\w-]+\)$/);
                if (color !== "var(--role-ink)") {
                    assert.notEqual(classOf(each), "text-ink", color);
                }
            }
        }
    });

    void it("creates the highlighter once for concurrent and later calls", async () => {
        const first = load();
        await Promise.all([tokensOf("a", "js"), tokensOf("b", "json")]);

        assert.equal(load(), first);
    });
});

void describe("classOf", () => {
    void it("maps a token colour to its role class, and an unknown colour to plain ink", () => {
        assert.equal(classOf(token("var(--role-code-keyword)")), "text-code-keyword");
        assert.equal(classOf(token("var(--role-danger)")), "text-danger");
        assert.equal(classOf(token("#ff0000")), "text-ink");
    });

    void it("adds italic and semibold from the font style bits", () => {
        assert.equal(classOf(token("var(--role-code-comment)", 1)), "text-code-comment italic");
        assert.equal(
            classOf(token("var(--role-code-function)", 2)),
            "text-code-function font-semibold",
        );
        assert.equal(
            classOf(token("var(--role-code-string)", 3)),
            "text-code-string italic font-semibold",
        );
    });
});
