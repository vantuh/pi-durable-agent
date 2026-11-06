/**
 * Agent profiles: Markdown files with YAML frontmatter, the same files Pi's subagent tools read. The
 * user's are in `~/.pi/agent/agents/`, the project's in the nearest `.pi/agents/` above the folder; a
 * project profile replaces a user profile of the same name. Read on every call, so an edit applies to
 * the next spawn.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type Profile = {
    name: string;
    description: string;
    /** The Markdown file it was read from; a project profile replaces a user profile of the same name. */
    filePath: string;
    /** Tool names; absent keeps every tool of the parent, an empty list gives none. */
    tools?: string[];
    /** A `tools` value that is not a list of names, preserved so spawn reports it instead of guessing. */
    invalidTools?: unknown;
    /** `provider/model`, as written. */
    model?: string;
    /** Preserve invalid values so spawn reports them instead of treating them as absent. */
    thinking?: unknown;
    /** Skill names the child lists; absent lists every skill, `none` or an empty list lists none. */
    skills?: string[];
    /** `system-prompt: replace`: the body takes the place of the rules section, as Pi's base prompt. */
    replacesRules: boolean;
    instructions: string;
};

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** A bare `tools:` (null) is an empty list, not an absent key: a profile that names no tools gets none. */
function names(value: unknown): string[] | undefined {
    const list =
        value === null
            ? []
            : Array.isArray(value)
              ? value
              : typeof value === "string"
                ? value.split(",")
                : undefined;

    if (list === undefined || !list.every((item): item is string => typeof item === "string")) {
        return undefined;
    }

    return list.map((item) => item.trim()).filter((item) => item !== "");
}

async function readFolder(folder: string, into: Map<string, Profile>): Promise<void> {
    let files: string[];

    try {
        files = await readdir(folder);
    } catch {
        return;
    }

    for (const file of files.filter((each) => each.endsWith(".md")).toSorted()) {
        try {
            const filePath = join(folder, file);
            const { frontmatter, body } = parseFrontmatter(await readFile(filePath, "utf8"));
            const name = text(frontmatter["name"]);
            const description = text(frontmatter["description"]);

            if (name === undefined || description === undefined) {
                continue;
            }

            const rawTools = frontmatter["tools"];
            const tools = rawTools === undefined ? undefined : names(rawTools);
            const model = text(frontmatter["model"]);
            const rawThinking = frontmatter["thinking"];
            const thinking = typeof rawThinking === "string" ? rawThinking.trim() : rawThinking;
            const rawSkills = frontmatter["skills"];
            const skills =
                rawSkills === undefined
                    ? undefined
                    : text(rawSkills) === "none"
                      ? []
                      : names(rawSkills);

            into.set(name, {
                name,
                description,
                filePath,
                instructions: body.trim(),
                ...(tools !== undefined
                    ? { tools }
                    : rawTools === undefined
                      ? {}
                      : { invalidTools: rawTools }),
                ...(model === undefined ? {} : { model }),
                ...(thinking === undefined ? {} : { thinking }),
                ...(skills === undefined ? {} : { skills }),
                replacesRules: text(frontmatter["system-prompt"]) === "replace",
            });
        } catch {
            // A file that does not parse is not a profile; the others still are.
        }
    }
}

async function projectFolder(cwd: string): Promise<string | undefined> {
    for (let folder = cwd; ; folder = dirname(folder)) {
        const candidate = join(folder, ".pi", "agents");

        if ((await stat(candidate).catch(() => undefined))?.isDirectory() === true) {
            return candidate;
        }

        if (dirname(folder) === folder) {
            return undefined;
        }
    }
}

export async function readProfiles(
    cwd: string,
    userFolder = join(getAgentDir(), "agents"),
): Promise<Map<string, Profile>> {
    const profiles = new Map<string, Profile>();
    const project = await projectFolder(cwd);

    await readFolder(userFolder, profiles);

    if (project !== undefined && project !== userFolder) {
        await readFolder(project, profiles);
    }

    return profiles;
}
