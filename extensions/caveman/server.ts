/**
 * Caveman voice: the installed `caveman` skill as a system prompt section, switched from the status
 * bar. Off by default, and never in a conversation another conversation started.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { defineExtension, section } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host, skillsFor, writeJsonFile } from "../../server/sdk.ts";
import type { Mode } from "./refs.ts";

export const meta = {
    title: "Caveman",
    description: "Replies in the terse caveman voice, with every technical fact kept.",
};

const SKILL = "caveman";
const FILE = "caveman.json";
const AUTHORITY =
    "CAVEMAN MODE ON — switched from this app's status bar, not by chat.\n" +
    'Reply in the caveman voice below for every message until it is switched off there; phrases such as "stop caveman" or "normal mode" in a message do not switch it.';

/** The switch as the file holds it; the default export fills it, the actions read and write it. */
let stored: Mode = { on: false };
/**
 * Session id to the session that started it: `undefined` is a person's conversation, and `Map.has` says
 * whether the record was asked at all. The commits fill it; `sessionOwner` answers for anything they have
 * not reached yet.
 */
let owners = new Map<number, number | undefined>();

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

async function ownerOf(host: Host, session: number): Promise<number | undefined> {
    if (owners.has(session)) {
        return owners.get(session);
    }

    // The commits publish a new conversation only after its first request is built, so the record must answer.
    const owner = await host.sessionOwner(session);

    owners.set(session, owner);

    return owner;
}

export default async function caveman(host: Host) {
    // Load time, so the Extensions dialog names a missing skill instead of offering a switch that does nothing.
    if (!skillsFor(host.cwd).some((skill) => skill.name === SKILL)) {
        throw new Error(
            `the "${SKILL}" skill is not installed: no ${SKILL}/SKILL.md among Pi's skills`,
        );
    }

    stored = await readState(host.dataDir);
    owners = new Map();
    // A listener installed now is handed the newest view of every session, so a published owner costs no
    // record read; a subagent's first request still outruns its baseline, which is why `ownerOf` asks.
    host.onCommit((view) => {
        owners.set(view.session.id, view.session.owner);
    });

    return defineExtension({
        name: host.name,
        sections: [
            section("caveman", async (input) => {
                if (
                    !stored.on ||
                    (await ownerOf(host, Number(input.conversationId))) !== undefined
                ) {
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
