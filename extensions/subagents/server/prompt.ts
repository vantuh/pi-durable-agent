import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { section, wrapSection } from "@earendil-works/pi-durable";

import { type Host, skillsFor } from "../../../server/sdk.ts";
import { ChildDoc } from "./docs.ts";
import { readProfiles } from "./profiles.ts";

const GUIDE = `## Agents
You are the Orchestrator. Keep your own context for decisions, synthesis, and talking to the user; hand off work that would fill it with searching, reading, or edits. Delegation through agent_spawn and agent_send is authorized here. Lean toward delegating, picking the smallest suitable profile from the list below; do the work yourself only when an exception below applies.

Use these roles only when a profile of that name is listed; never ask for or invent an absent one, pick another listed profile or do the work yourself:
- Repository facts (where is X, how does Y flow, what calls Z): scout, one per independent question, in parallel; then read only the files their summaries name. Exception: one known file answers it in one or two reads.
- Web or external information: researcher. Exception: a single quick lookup.
- Edits and implementation: worker, with the check to run in its task. Chain scout then worker when the area is unfamiliar. Exception: a small edit in a file you already have open (rename, one-line fix, moving a few lines).
- After a non-trivial worker change, reviewer gives an independent review.
- You stay accountable: read the diff and run the check yourself before reporting success.

Agents can only start from existing Markdown profiles. Their model and thinking come only from the profile (omitted thinking means off). Never pass model, thinking, or thinkingLevel overrides to agent_spawn. If a profile is invalid or its model is unavailable, no agent starts: report the tool error, choose another existing profile, or ask the user to fix the profile. Do not invent a replacement model.

Agents do not see this conversation. Each task must be self-contained: goal, scope, paths or links, constraints, expected output, read-only vs edit permission, and, for edits, the check to run.

Run parallel agent_spawn calls only for independent work: separate reads or disjoint write slices, at most 4, each with a distinct name. Parallel writers only on disjoint files, and one writer per worktree.

An agent's tools run in this conversation's folder unless you pass cwd, an absolute folder: when the work belongs in a worktree you made, pass that worktree's path, and the agent's relative paths, edits, and commands all go there instead.

Every call returns once the task is submitted. The result arrives as a message that starts with "[agent", even in the middle of your turn. Never wait for it: no status checks to see if it finished, no sleep. Do not redo delegated work yourself; end the turn or continue unrelated work.

A result is a report: verify claims you act on, and synthesize it for the user instead of pasting it. A blocked result or a question needs your decision: answer it with agent_send, or handle the work yourself.

agent_send reaches an existing agent by name: it steers a working agent at its next step, or gives an idle one a new message that keeps its context. Steer only when a correction must reach work already in progress, never to check progress. Stop a run with agent_stop only when the user or a decision requires it; the agent keeps its context. Check an agent with agent_status only when the user asks or a decision you must make now depends on its progress.`;

export const PROTOCOL = `## Agent protocol
You are an agent another agent (the Orchestrator) started for one task. It does not see your work, only your final answer, which is delivered to it as a report. Give the complete answer as text, and keep progress narration short.

If the task is ambiguous, or a decision would materially change its scope, end your turn with the question instead of guessing; the Orchestrator answers with a message. Do not ask about what you can settle by reading the project.

End with one line: AGENT_RESULT: done | blocked — <one-line summary>`;

/** The `agents` section, and the wraps that give an agent its profile's rules and skills. */
export function promptParts(host: Host) {
    return {
        sections: [
            // Agents get no agents of their own: no tools (see `childAgent`) and no profile list.
            section("agents", async (input, context) => {
                if (
                    (await input.read.snapshot(ChildDoc, input.conversationId, context)) !==
                    undefined
                ) {
                    return undefined;
                }

                const profiles = await readProfiles(input.agent.cwd ?? host.cwd);
                const list = [...profiles.values()]
                    .map((profile) => `- ${profile.name}: ${profile.description}`)
                    .join("\n");

                return `${GUIDE}\n\nProfiles:\n${list || "- none: add one to ~/.pi/agent/agents"}`;
            }),
        ],
        // Pi's `system-prompt: replace` and `skills`, by section key: whichever extension renders them.
        wraps: [
            wrapSection("rules", (rules) => ({
                ...rules,
                render: async (input, context) =>
                    (await input.read.snapshot(ChildDoc, input.conversationId, context))?.rules ===
                    false
                        ? undefined
                        : rules.render(input, context),
            })),
            wrapSection("skills", (skills) => ({
                ...skills,
                render: async (input, context) => {
                    const wanted = (
                        await input.read.snapshot(ChildDoc, input.conversationId, context)
                    )?.skills;

                    if (wanted === undefined || wanted === null) {
                        return skills.render(input, context);
                    }

                    const names = new Set(input.agent.tools.map((tool) => tool.name));
                    // As the skills section itself: a skill is loaded by reading its file.
                    const reader = (["read", "bash"] as const).find((name) => names.has(name));
                    const listed = skillsFor(input.agent.cwd ?? host.cwd).filter((skill) =>
                        wanted.includes(skill.name),
                    );

                    return reader === undefined || listed.length === 0
                        ? undefined
                        : formatSkillsForPrompt(listed, reader).trim() || undefined;
                },
            })),
        ],
    };
}
