/**
 * The rules the agent works under, as one system prompt section. The first extension: everything the
 * agent is told about how to behave lives in a folder like this one, not in the core.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
    formatSkillsForPrompt,
    getAgentDir,
    loadProjectContextFiles,
    loadSkills,
} from "@earendil-works/pi-coding-agent";
import { defineExtension, section } from "@earendil-works/pi-durable";

import type { Host } from "../../server/extensions.ts";

const RULES = [
    "You are a coding agent working in a project folder. You read, edit, and run commands there.",
    "Keep each change small and focused. Do not reformat code you did not need to touch.",
    "Run the project's checks before you say a change is done; if one cannot run, say why.",
    "Ask before anything irreversible. Never claim a result you did not see.",
].join("\n");

export const meta = {
    title: "Rules prompt",
    description: "Gives the agent its working rules as a system prompt section.",
};

export default function prompt(host: Host) {
    return defineExtension({
        name: host.name,
        sections: [
            section("rules", (input) => `Project folder: ${input.agent.cwd}\n\n${RULES}`, {
                tag: false,
            }),
            // Pi's own loaders and folders: `AGENTS.md` (or `CLAUDE.md`) in `~/.pi/agent` and from the session's folder
            // up to `/`; skills from `~/.pi/agent/skills` and `<cwd>/.pi/skills`, `<cwd>/.agents/skills`, `~/.agents/skills`. Read on every prompt build, so edits
            // show up on the next run.
            section(
                "project_context",
                (input) =>
                    loadProjectContextFiles({
                        cwd: input.agent.cwd ?? host.cwd,
                        agentDir: getAgentDir(),
                    })
                        .map(
                            (file) =>
                                `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`,
                        )
                        .join("\n\n") || undefined,
                { tag: false },
            ),
            section(
                "skills",
                (input) => {
                    const names = new Set((input.agent.tools ?? []).map((tool) => tool.name));
                    // A skill is loaded by reading its file: without a tool that can, list none.
                    const reader = (["read", "bash"] as const).find((name) => names.has(name));

                    if (!reader) {
                        return undefined;
                    }

                    const cwd = input.agent.cwd ?? host.cwd;
                    const { skills } = loadSkills({
                        cwd,
                        agentDir: getAgentDir(),
                        // The shared Agent Skills folders, after Pi's own: on a name clash the first one wins.
                        skillPaths: [
                            join(cwd, ".agents", "skills"),
                            join(homedir(), ".agents", "skills"),
                        ],
                        includeDefaults: true,
                    });

                    return formatSkillsForPrompt(skills, reader).trim() || undefined;
                },
                { tag: false },
            ),
        ],
    });
}
