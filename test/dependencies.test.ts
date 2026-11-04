import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { describe, it } from "node:test";

import { isRecord } from "../shared/guards.ts";

const ROOT = new URL("../", import.meta.url);

function manifest(folder: URL): Record<string, unknown> {
    const value: unknown = JSON.parse(readFileSync(new URL("package.json", folder), "utf8"));

    assert.ok(isRecord(value));

    return value;
}

function packages(value: Record<string, unknown>, section: string): string[] {
    const entries = value[section] ?? {};

    assert.ok(isRecord(entries));

    return Object.keys(entries);
}

const core = manifest(ROOT);
const corePackages = new Set([
    ...packages(core, "dependencies"),
    ...packages(core, "devDependencies"),
]);
const extensions = readdirSync(new URL("extensions/", ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_.]/.test(entry.name))
    .map((entry) => {
        const folder = new URL(`extensions/${entry.name}/`, ROOT);

        return { name: entry.name, folder, package: manifest(folder) };
    });

void describe("workspace dependencies", () => {
    void it("keeps extension-owned runtime dependencies out of the core runtime manifest", () => {
        const coreRuntime = new Set(packages(core, "dependencies"));

        for (const extension of extensions) {
            for (const section of ["dependencies", "optionalDependencies"]) {
                for (const name of packages(extension.package, section)) {
                    assert.ok(!coreRuntime.has(name), `${extension.name} owns ${name}`);
                }
            }
        }
    });

    void it("installs each extension's required packages in its own workspace", () => {
        for (const extension of extensions) {
            for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
                for (const name of packages(extension.package, section)) {
                    assert.ok(
                        existsSync(new URL(`node_modules/${name}/package.json`, extension.folder)),
                        `${extension.name} has a local link for ${name}`,
                    );
                }
            }
        }
    });

    void it("resolves host peers to the same package instances as the core", () => {
        for (const extension of extensions) {
            for (const name of packages(extension.package, "peerDependencies")) {
                assert.ok(corePackages.has(name), `core provides ${extension.name}'s peer ${name}`);
                assert.equal(
                    realpathSync(new URL(`node_modules/${name}`, extension.folder)),
                    realpathSync(new URL(`node_modules/${name}`, ROOT)),
                    `${extension.name} shares ${name} with core`,
                );
            }
        }
    });
});
