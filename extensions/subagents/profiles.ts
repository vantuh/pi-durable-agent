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
    /** Tool names; absent keeps every tool of the parent. */
    tools?: string[];
    /** `provider/model`, as written. */
    model?: string;
    thinking?: string;
    instructions: string;
};

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function names(value: unknown): string[] | undefined {
    const list = Array.isArray(value)
        ? value.filter((item) => typeof item === "string")
        : typeof value === "string"
          ? value.split(",")
          : [];
    const trimmed = list.map((item) => item.trim()).filter((item) => item !== "");

    return trimmed.length === 0 ? undefined : trimmed;
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
            const { frontmatter, body } = parseFrontmatter(
                await readFile(join(folder, file), "utf8"),
            );
            const name = text(frontmatter["name"]);
            const description = text(frontmatter["description"]);

            if (name === undefined || description === undefined) {
                continue;
            }

            const tools = names(frontmatter["tools"]);
            const model = text(frontmatter["model"]);
            const thinking = text(frontmatter["thinking"]);

            into.set(name, {
                name,
                description,
                instructions: body.trim(),
                ...(tools === undefined ? {} : { tools }),
                ...(model === undefined ? {} : { model }),
                ...(thinking === undefined ? {} : { thinking }),
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
