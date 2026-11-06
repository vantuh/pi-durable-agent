import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse, type Command } from "unbash";

import { bare, program, redirectLabel } from "./describe.ts";

function first(source: string): Command {
    const command = parse(source).commands[0]?.command;

    assert.equal(command?.type, "Command");

    return command;
}

void describe("program", () => {
    void it("is the file name past wrappers and their options", () => {
        assert.equal(program(first("./node_modules/.bin/vite build")), "vite");
        assert.equal(program(first("timeout 3 curl https://x.test")), "curl");
        assert.equal(program(first("env -i HOME=/tmp sudo -E git status")), "git");
        assert.equal(program(first("result=$?")), undefined);
    });
});

void describe("bare and redirectLabel", () => {
    void it("take the redirects out of the command and say what each does", () => {
        const source =
            "pnpm test > /tmp/test.log 2>&1 --reporter dot 2>/dev/null < in.txt &>> all.log";
        const command = first(source);

        assert.equal(bare(source, command.pos, command.end, command), "pnpm test --reporter dot");
        assert.deepEqual(
            command.redirects.map((redirect) => redirectLabel(source, redirect)),
            [
                "writes /tmp/test.log",
                "errors into output",
                "hides errors",
                "reads in.txt",
                "all output → all.log",
            ],
        );
    });
});
