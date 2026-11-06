/**
 * The module resolve hook that gives an extension's helper files the version of the module that imports them, so
 * a reload runs new helper code. One hook per process; every `Extensions` adds its directory to it.
 */

import { realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The `extensions/` directories of every `Extensions` in this process, as paths ending in a separator. */
const roots = new Set<string>();
let hooked = false;

/**
 * Gives a helper the version query of the module that imports it, so a reload runs new helper code.
 * Only files inside the same extension folder get it: packages and core files stay single instances.
 */
function versionHelpers(): void {
    if (hooked) {
        return;
    }

    hooked = true;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            const resolved = nextResolve(specifier, context);
            const parent = context.parentURL;

            if (
                parent === undefined ||
                !parent.startsWith("file:") ||
                !resolved.url.startsWith("file:")
            ) {
                return resolved;
            }

            const version = new URL(parent).searchParams.get("v");

            if (version === null) {
                return resolved;
            }

            const from = fileURLToPath(parent);
            const to = fileURLToPath(resolved.url);

            for (const root of roots) {
                if (!from.startsWith(root)) {
                    continue;
                }

                const folder = `${root}${from.slice(root.length).split(sep)[0] ?? ""}${sep}`;

                if (to.startsWith(folder) && !to.includes(`${sep}node_modules${sep}`)) {
                    const url = new URL(resolved.url);

                    url.searchParams.set("v", version);

                    return { ...resolved, url: url.href };
                }
            }

            return resolved;
        },
    });
}

/** Starts versioning the helper imports of the extensions under `dir`; the hook is registered once. */
export function versionHelpersIn(dir: string): void {
    // Node resolves symlinks, so the hook sees real paths (macOS: /var is /private/var).
    roots.add(join(realpathSync(dir), sep));
    versionHelpers();
}
