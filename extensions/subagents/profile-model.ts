/**
 * The model of an agent profile, written where the spawn reads it: the top-level `model:` and
 * `thinking:` lines of the frontmatter, and no other byte of the file. Ported from
 * `pi-herdr-subagents` `src/ui/agent-models/write.ts` (MIT, Copyright (c) 2026 vantuh), which keeps
 * the same rules: a symlink is edited where it points, the file is replaced atomically, and an edit
 * that would change any other field is refused instead of written.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { ActionError, writeFileAtomic } from "../../server/sdk.ts";

/** What to write; null removes the line, so the profile names neither. */
export type ProfileModel = {
    /** `provider/modelId`, as the model picker names it. */
    model: string | null;
    /** A thinking level the model supports, written beside the model. */
    thinking: string | null;
};

/** Whether the edited file parses to the same fields, with the two this edit names replaced. */
function sameFrontmatter(content: string, expected: Record<string, unknown>): boolean {
    try {
        return isDeepStrictEqual(parseFrontmatter(content).frontmatter, expected);
    } catch {
        return false;
    }
}

/**
 * Writes the model and the thinking level into a profile, keeping its mode, its line endings and its
 * body. Throws an `ActionError` for a file it will not touch and the file system's own error for a
 * write that fails.
 */
export async function writeProfileModel(filePath: string, edit: ProfileModel): Promise<void> {
    const target = await realpath(filePath);
    const content = await readFile(target, "utf8");
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);

    if (lines[0] !== "---") {
        throw new ActionError("The profile has no frontmatter block.");
    }

    const wanted = [
        ["model", edit.model],
        ["thinking", edit.thinking],
    ] as const;

    /** The indices of the top-level `key:` lines inside the block, before anything moves. */
    const scan = (key: string): number[] => {
        const end = lines.indexOf("---", 1);

        if (end < 0) {
            throw new ActionError("The profile has no complete frontmatter block.");
        }

        return lines
            .map((_line, index) => index)
            .filter((index) => index > 0 && index < end && lines[index]?.startsWith(`${key}:`));
    };

    const found = new Map(wanted.map(([key]) => [key, scan(key)]));

    for (const [key, indices] of found) {
        if (indices.length > 1) {
            throw new ActionError(`The profile has more than one ${key}: line.`);
        }
    }

    let frontmatter: Record<string, unknown>;

    try {
        frontmatter = parseFrontmatter(content).frontmatter;
    } catch (error) {
        throw new ActionError(
            `The profile's frontmatter does not parse: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const expected = { ...frontmatter };
    const inserted: string[] = [];

    for (const [key, value] of wanted) {
        // Recomputed: the lines moved when the previous key was inserted or removed.
        const index = scan(key)[0];

        if (index === undefined && Object.hasOwn(frontmatter, key)) {
            throw new ActionError(
                `The profile's ${key} is not a top-level single-line ${key}: line; edit it by hand.`,
            );
        }

        if (value === null) {
            if (index !== undefined) {
                lines.splice(index, 1);
            }

            delete expected[key];
        } else {
            const line = `${key}: ${JSON.stringify(value)}`;

            if (index === undefined) {
                inserted.push(line);
            } else {
                lines[index] = line;
            }

            expected[key] = value;
        }
    }

    // Both new lines go under the opening marker, in the order this edit names them.
    lines.splice(1, 0, ...inserted);

    const updated = lines.join(newline);

    // A line edit must not absorb a multiline value or change a field nobody asked about.
    if (!sameFrontmatter(updated, expected)) {
        throw new ActionError("The profile's frontmatter cannot be changed here; edit it by hand.");
    }

    const { mode } = await stat(target);

    await writeFileAtomic(target, updated, { mode: mode & 0o777 });
}
