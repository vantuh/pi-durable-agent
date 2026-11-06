import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = join(import.meta.dirname, "..");

/** Each file imports one thing; `rejected` says whether the extension rule must refuse it. */
const FILES: { path: string; imports: string; rejected: boolean }[] = [
    { path: "top.ts", imports: "./server/helper.ts", rejected: false },
    { path: "top.ts", imports: "../../server/extensions/extensions.ts", rejected: true },
    { path: "top.ts", imports: "../../server/sdk.ts", rejected: false },
    { path: "server/own.ts", imports: "./helper.ts", rejected: false },
    { path: "server/own.ts", imports: "../refs.ts", rejected: false },
    { path: "server/own.ts", imports: "../../../server/extensions/extensions.ts", rejected: true },
    { path: "server/own.ts", imports: "../../../server/sdk.ts", rejected: false },
    { path: "web/own.tsx", imports: "../server/helper.ts", rejected: false },
    { path: "web/own.tsx", imports: "../../../server/http.ts", rejected: true },
];

void describe("the lint rule that keeps extensions out of the core server", () => {
    let folder: string;
    let refused: Set<string>;

    before(async () => {
        // Inside the repository, under `extensions/`, so the rule's file glob applies; a dot folder is
        // skipped by the loader and by the workspace tests.
        folder = await mkdtemp(join(ROOT, "extensions", ".lint-guard-"));
        await mkdir(join(folder, "server"));
        await mkdir(join(folder, "web"));

        // One file per import, so a diagnostic names exactly one of them.
        for (const [index, file] of FILES.entries()) {
            const path = file.path.replace(/(\.tsx?)$/, `-${String(index)}$1`);

            file.path = path;
            await writeFile(
                join(folder, path),
                `import { x } from "${file.imports}";\n\nexport const y = x;\n`,
            );
        }

        const run = spawnSync(
            join(ROOT, "node_modules/.bin/oxlint"),
            ["-c", join(ROOT, ".oxlintrc.json"), "--format", "json", relative(ROOT, folder)],
            { cwd: ROOT, encoding: "utf8" },
        );
        const report: unknown = JSON.parse(run.stdout);
        const diagnostics =
            typeof report === "object" && report !== null ? Reflect.get(report, "diagnostics") : [];

        assert.ok(Array.isArray(diagnostics), run.stderr);
        refused = new Set(
            diagnostics.flatMap((diagnostic: unknown) => {
                const code: unknown = Reflect.get(Object(diagnostic), "code");
                const filename: unknown = Reflect.get(Object(diagnostic), "filename");

                return typeof code === "string" &&
                    code.includes("no-restricted-imports") &&
                    typeof filename === "string"
                    ? [relative(folder, join(ROOT, filename))]
                    : [];
            }),
        );
    });

    after(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    for (const file of FILES) {
        void it(`${file.rejected ? "refuses" : "allows"} ${file.imports} from ${file.path}`, () => {
            assert.equal(refused.has(file.path), file.rejected);
        });
    }
});
