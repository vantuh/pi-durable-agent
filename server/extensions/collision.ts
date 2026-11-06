/** Whether an extension may be installed beside the ones already in the registry. */

import type { Extension, Registry } from "@earendil-works/pi-durable";

/** A tool or section of `extension` that another installed extension provides; `wraps` is the way to take one over. */
export function collisionOf(registry: Registry, extension: Extension): string | undefined {
    for (const other of registry.snapshot().installed()) {
        if (other.name === extension.name) {
            continue;
        }
        const tool = extension.tools?.find(({ name }) =>
            other.tools?.some((theirs) => theirs.name === name),
        );

        if (tool !== undefined) {
            return `tool "${tool.name}" is already provided by "${other.name}"`;
        }
        const section = extension.sections?.find(({ key }) =>
            other.sections?.some((theirs) => theirs.key === key),
        );

        if (section !== undefined) {
            return `section "${section.key}" is already provided by "${other.name}"`;
        }
    }

    return undefined;
}
