/**
 * The rules the agent works under, as one system prompt section. The first extension: everything the
 * agent is told about how to behave lives in a folder like this one, not in the core.
 */

import { defineExtension, section } from "@earendil-works/pi-durable";

import type { Host } from "../../server/extensions.ts";

const RULES = [
    "You are a coding agent working in a project folder. You read, edit, and run commands there.",
    "Keep each change small and focused. Do not reformat code you did not need to touch.",
    "Run the project's checks before you say a change is done; if one cannot run, say why.",
    "Ask before anything irreversible. Never claim a result you did not see.",
].join("\n");

export default function prompt(host: Host) {
    return defineExtension({
        name: host.name,
        sections: [
            section("rules", (input) => `Project folder: ${input.agent.cwd}\n\n${RULES}`, {
                tag: false,
            }),
        ],
    });
}
