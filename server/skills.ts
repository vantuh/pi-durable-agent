/**
 * Pi's skills for a session's folder. The prompt lists them for the agent; the browser lists them behind `/`; a message
 * that starts with `/skill:name` carries the skill's instructions. The first skill of a name wins, in this order:
 * `~/.pi/agent/skills`, `<cwd>/.pi/skills`, `<cwd>/.agents/skills`, `~/.agents/skills`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getAgentDir, loadSkills, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Skill } from "@earendil-works/pi-coding-agent";

export function skillsFor(cwd: string): Skill[] {
    return loadSkills({
        cwd,
        agentDir: getAgentDir(),
        skillPaths: [join(cwd, ".agents", "skills"), join(homedir(), ".agents", "skills")],
        includeDefaults: true,
    }).skills;
}

/**
 * `/skill:name request` as Pi's AgentSession expands it: the skill's body in a `<skill>` block, then the request.
 * Text that is not such a command, or names an unknown skill, comes back as it was.
 */
export function expandSkillCommand(text: string, skills: readonly Skill[]): string {
    // Pi upstream: @earendil-works/pi-coding-agent@1.4.0 src/core/agent-session.ts _expandSkillCommand: copied block format.
    const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    const skill = match === null ? undefined : skills.find((each) => each.name === match[1]);

    if (match === null || skill === undefined) {
        return text;
    }

    let body: string;

    try {
        body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
    } catch {
        return text;
    }

    const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    const request = match[2]?.trim();

    return request === undefined || request === "" ? block : `${block}\n\n${request}`;
}
