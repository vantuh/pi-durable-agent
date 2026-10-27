import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { expandSkillCommand, skillsFor } from "../server/skills.ts";

void test("a project skill is found and /skill:name expands to its body plus the request", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skills-"));

    try {
        const folder = join(cwd, ".agents", "skills", "zz-demo");

        mkdirSync(folder, { recursive: true });
        writeFileSync(
            join(folder, "SKILL.md"),
            "---\nname: zz-demo\ndescription: Demo skill\n---\nDo the demo.\n",
        );

        const skills = skillsFor(cwd);

        assert.ok(skills.some((skill) => skill.name === "zz-demo"));

        const expanded = expandSkillCommand("/skill:zz-demo now please", skills);

        assert.match(expanded, /^<skill name="zz-demo" location=".*SKILL\.md">/);
        assert.match(expanded, /Do the demo\.\n<\/skill>\n\nnow please$/);
        assert.equal(expandSkillCommand("/skill:nope x", skills), "/skill:nope x");
        assert.equal(expandSkillCommand("plain text", skills), "plain text");
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
