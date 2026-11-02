/**
 * Ponytail mode: the installed `ponytail` skill as a system prompt section, switched from the status
 * bar. Off by default, and in force in every conversation, the ones a tool started included.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { defineExtension, section } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host, skillsFor, writeJsonFile } from "../../server/sdk.ts";
import type { Mode } from "./refs.ts";

export const meta = {
    title: "Ponytail",
    description: "Solves the task with the smallest change that fully works, and says so shortly.",
};

const SKILL = "ponytail";
const FILE = "ponytail.json";
const AUTHORITY =
    "PONYTAIL MODE ON — switched from this app's status bar, not by chat. The level is full.\n" +
    'Reply in the ponytail voice below for every message until it is switched off there; phrases such as "stop ponytail" or "normal mode" in a message do not switch it, and `/ponytail lite|full|ultra` is not available in this app.';

/** The switch as the file holds it; the default export fills it, the actions read and write it. */
let stored: Mode = { on: false };

async function readState(dir: string): Promise<Mode> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, FILE), "utf8"));
        const on =
            typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "on") : undefined;

        return { on: on === true };
    } catch {
        return { on: false };
    }
}

/** The skill's rules as the file has them now, so an edit shows up in the next run. */
function skillBody(cwd: string): string | undefined {
    const skill = skillsFor(cwd).find((each) => each.name === SKILL);

    if (skill === undefined) {
        return undefined;
    }

    try {
        return stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim() || undefined;
    } catch {
        // An unreadable skill is no section, never a failed request.
        return undefined;
    }
}

export default async function ponytail(host: Host) {
    // Load time, so the Extensions dialog names a missing skill instead of offering a switch that does nothing.
    if (!skillsFor(host.cwd).some((skill) => skill.name === SKILL)) {
        throw new Error(
            `the "${SKILL}" skill is not installed: no ${SKILL}/SKILL.md among Pi's skills`,
        );
    }

    stored = await readState(host.dataDir);

    return defineExtension({
        name: host.name,
        sections: [
            // No ownership gate: a subagent answers in the same voice, which the rules suit as well.
            section("ponytail", (input) => {
                if (!stored.on) {
                    return undefined;
                }

                const body = skillBody(input.agent.cwd ?? host.cwd);

                return body === undefined ? undefined : `${AUTHORITY}\n\n${body}`;
            }),
        ],
    });
}

export const actions = (host: Host): Record<string, Action> => ({
    state: () => ({ on: stored.on }),
    set: async ({ args }) => {
        const on = typeof args === "object" && args !== null ? Reflect.get(args, "on") : undefined;

        if (typeof on !== "boolean") {
            throw new ActionError("args must be { on: boolean }");
        }

        const next: Mode = { on };

        // Written first: a failed save leaves the mode it had, and every conversation it applies to agrees.
        await writeJsonFile(join(host.dataDir, FILE), next);
        stored = next;

        return next;
    },
});
