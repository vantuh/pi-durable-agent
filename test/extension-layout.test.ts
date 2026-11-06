import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

// The layout is written in docs/extensions.md#the-layout.
const EXTENSIONS = join(import.meta.dirname, "..", "extensions");
const FILES = new Set([
    "package.json",
    "README.md",
    "server.ts",
    "server.test.ts",
    "web.tsx",
    "details.tsx",
    "refs.ts",
]);
const FOLDERS = new Set(["server", "web", "assets", "fixtures", "node_modules"]);

type Entry = { name: string; isDirectory: () => boolean };

/** What a top level holds that the layout does not name. */
function strays(entries: Entry[]): string[] {
    return entries
        .filter((entry) =>
            entry.isDirectory()
                ? !FOLDERS.has(entry.name)
                : !FILES.has(entry.name) && !entry.name.startsWith("LICENSE."),
        )
        .map((entry) => entry.name);
}

/** The code the browser bundle loads: the entries, `refs.ts`, and everything in `web/` but its tests. */
function browserFiles(root: string): string[] {
    const found = ["web.tsx", "details.tsx", "refs.ts"]
        .map((name) => join(root, name))
        .filter((path) => existsSync(path));

    if (existsSync(join(root, "web"))) {
        for (const entry of readdirSync(join(root, "web"), {
            recursive: true,
            withFileTypes: true,
        })) {
            if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                found.push(join(entry.parentPath, entry.name));
            }
        }
    }

    return found;
}

/** Every module a source names: static, side-effect and `export ... from` imports, and `import()`. */
function specifiers(source: string): { specifier: string; typeOnly: boolean }[] {
    const found: { specifier: string; typeOnly: boolean }[] = [];
    // `import type` and `export type` are erased; `import { type X }` is not (verbatimModuleSyntax keeps the import).
    const statements = /\b(?:import|export)\s+(type\s+)?(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/g;
    const dynamic = /\bimport\(\s*["']([^"']+)["']/g;

    for (const match of source.matchAll(statements)) {
        found.push({ specifier: match[2] ?? "", typeOnly: match[1] !== undefined });
    }

    for (const match of source.matchAll(dynamic)) {
        found.push({ specifier: match[1] ?? "", typeOnly: false });
    }

    return found;
}

/**
 * Why browser-loaded code at `path` (in the extension at `root`) must not carry this source: it imports a Node
 * builtin, with or without `node:`, or code of the extension's own `server/`. `refs.ts` is for both halves.
 */
function offences(path: string, root: string, source: string): string[] {
    const server = join(root, "server") + sep;

    return specifiers(source).flatMap(({ specifier, typeOnly }) => {
        if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
            return [`imports ${specifier}`];
        }

        const target = specifier.startsWith(".") ? resolve(dirname(path), specifier) : "";

        return !typeOnly && target.startsWith(server) ? [`imports ${specifier} from server/`] : [];
    });
}

/** The folders the loader looks at: a dot or underscore folder is parked or temporary. */
const folders = readdirSync(EXTENSIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[._]/.test(entry.name))
    .map((entry) => entry.name);

const file = (name: string): Entry => ({ name, isDirectory: () => false });
const folder = (name: string): Entry => ({ name, isDirectory: () => true });

void describe("the extension layout", () => {
    void it("names a file or folder the layout does not have", () => {
        assert.deepEqual(
            strays([
                file("server.ts"),
                file("LICENSE.pi-pocket"),
                folder("web"),
                file("helper.ts"),
                file("sw.js"),
                folder("lib"),
            ]),
            ["helper.ts", "sw.js", "lib"],
        );
    });

    for (const name of folders) {
        void it(`${name} keeps only the layout at its top level`, () => {
            assert.deepEqual(
                strays(readdirSync(join(EXTENSIONS, name), { withFileTypes: true })),
                [],
            );
        });
    }

    void it("names Node and server code in what the browser loads", () => {
        const root = "/x/ext";
        const refused = (source: string): boolean =>
            offences(`${root}/web/a.tsx`, root, source).length > 0;

        assert.ok(refused('import { x } from "node:fs";'));
        assert.ok(refused('const m = await import("node:fs");'));
        assert.ok(refused('import { readFileSync } from "fs";'));
        assert.ok(refused('import { readFile } from "fs/promises";'));
        assert.ok(refused('import "node:fs";'));
        assert.ok(refused('export { x } from "path";'));
        assert.ok(refused('import { helper } from "../server/helper.ts";'));
        assert.ok(refused('import {\n    a,\n} from "../server/helper.ts";'));
        assert.ok(refused('const m = await import("../server/helper.ts");'));
        assert.ok(!refused('import type { Helper } from "../server/helper.ts";'));
        assert.ok(!refused('import { x } from "../refs.ts";'));
        assert.ok(!refused('import { useState } from "react";'));
        assert.ok(!refused('import { Button } from "@/components/ui/button";'));
        assert.ok(!refused('import { path } from "./path.ts";'));
        assert.ok(!offences(`${root}/web.tsx`, root, 'import { a } from "./web/a.tsx";').length);
        assert.ok(
            offences(`${root}/web.tsx`, root, 'import { a } from "./server/a.ts";').length > 0,
        );
    });

    void it("keeps Node and server code out of what the browser loads", () => {
        const offenders = folders.flatMap((name) => {
            const root = join(EXTENSIONS, name);

            return browserFiles(root).flatMap((path) =>
                offences(path, root, readFileSync(path, "utf8")).map((why) => `${path}: ${why}`),
            );
        });

        assert.deepEqual(offenders, []);
    });
});
