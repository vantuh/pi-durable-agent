import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ActionError } from "../../server/sdk.ts";
import { writeProfileModel } from "./profile-model.ts";

const FRONTMATTER = "---\nname: counter\ndescription: Counts things\ntools: read, grep\n";

void describe("writeProfileModel", () => {
    let dir: string;
    let file: string;

    const profile = (frontmatter: string, body = "\nYou count.\n"): string =>
        `${frontmatter}---\n${body}`;

    async function read(): Promise<string> {
        return readFile(file, "utf8");
    }

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "subagents-model-"));
        file = join(dir, "counter.md");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("inserts the model and thinking when the profile names neither", async () => {
        await writeFile(file, profile(FRONTMATTER));
        await writeProfileModel(file, { model: "faux/profile", thinking: "low" });

        assert.equal(
            await read(),
            profile(
                `---\nmodel: "faux/profile"\nthinking: "low"\nname: counter\ndescription: Counts things\ntools: read, grep\n`,
            ),
            "both lines go under the opening marker, and no other line changes",
        );
    });

    void it("replaces a model in place and leaves the rest of the file alone", async () => {
        const before = profile(
            `${FRONTMATTER}model: old/model\nthinking: high\n`,
            "\nYou count.\n",
        );

        await writeFile(file, before);
        await writeProfileModel(file, { model: "new/model", thinking: "max" });

        assert.equal(
            await read(),
            profile(`${FRONTMATTER}model: "new/model"\nthinking: "max"\n`, "\nYou count.\n"),
            "the body, the other fields and the line order are untouched",
        );
    });

    void it("removes both lines when the model is cleared", async () => {
        await writeFile(file, profile(`${FRONTMATTER}model: "faux/profile"\nthinking: low\n`));
        await writeProfileModel(file, { model: null, thinking: null });

        const after = await read();

        assert.equal(after, profile(FRONTMATTER));
        assert.ok(!after.includes("model:"));
        assert.ok(!after.includes("thinking:"));
    });

    void it("keeps CRLF line endings", async () => {
        const before =
            "---\r\nname: counter\r\ndescription: Counts things\r\n---\r\n\r\nYou count.\r\n";

        await writeFile(file, before);
        await writeProfileModel(file, { model: "faux/profile", thinking: "low" });

        const after = await read();

        assert.equal(
            after,
            '---\r\nmodel: "faux/profile"\r\nthinking: "low"\r\nname: counter\r\ndescription: Counts things\r\n---\r\n\r\nYou count.\r\n',
        );
        assert.ok(!/[^\r]\n/.test(after), "no bare LF is introduced");
    });

    void it("edits the file a symlink points at and keeps the link", async () => {
        const target = join(dir, "real.md");

        await writeFile(target, profile(FRONTMATTER));
        await symlink(target, file);
        await writeProfileModel(file, { model: "faux/profile", thinking: null });

        assert.equal((await lstat(file)).isSymbolicLink(), true, "the profile stays a symlink");
        assert.match(await readFile(target, "utf8"), /model: "faux\/profile"/);
        assert.match(await readFile(file, "utf8"), /model: "faux\/profile"/);
    });

    void it("keeps the file mode", async () => {
        await writeFile(file, profile(FRONTMATTER), { mode: 0o640 });
        await writeProfileModel(file, { model: "faux/profile", thinking: null });

        assert.equal((await stat(file)).mode & 0o777, 0o640);
    });

    void it("finishes two edits started together, leaving one whole file", async () => {
        await writeFile(file, profile(FRONTMATTER));

        await Promise.all([
            writeProfileModel(file, { model: "faux/one", thinking: "low" }),
            writeProfileModel(file, { model: "faux/two", thinking: "high" }),
        ]);

        const content = await read();

        assert.equal(content.match(/^model: /gm)?.length, 1, "one model line, from one of the two");
        assert.equal(content.match(/^thinking: /gm)?.length, 1);
        assert.match(content, /^model: "faux\/(one|two)"$/m);
    });

    void it("refuses a file without a complete frontmatter block", async () => {
        await writeFile(file, "Just instructions.\n");

        await assert.rejects(
            writeProfileModel(file, { model: "faux/profile", thinking: null }),
            ActionError,
        );
        assert.equal(await read(), "Just instructions.\n", "the file is left as it was");
    });

    void it("refuses a repeated model: line instead of guessing which one wins", async () => {
        const before = profile(`${FRONTMATTER}model: one/model\nmodel: two/model\n`);

        await writeFile(file, before);

        await assert.rejects(writeProfileModel(file, { model: "new/model", thinking: null }), {
            message: /more than one model: line/,
        });
        assert.equal(await read(), before);
    });

    void it("refuses a value that runs over more than one line", async () => {
        const before = `---\nname: counter\ndescription: Counts things\nmodel: >\n  faux/profile\n---\n\nYou count.\n`;

        await writeFile(file, before);

        await assert.rejects(writeProfileModel(file, { model: "faux/profile", thinking: null }), {
            message: /edit it by hand/,
        });
        assert.equal(await read(), before, "the folded value and its continuation line stay");
    });
});
