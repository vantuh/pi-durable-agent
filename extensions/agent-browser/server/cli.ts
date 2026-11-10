/** The `agent-browser` CLI: one call per command, each session's daemon and Chrome kept by agent-browser itself. */
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { messageOf, recordOf } from "../../../shared/guards.ts";

/** The package's launcher: it picks this platform's binary from the package and makes it executable. */
const LAUNCHER = join(
    dirname(fileURLToPath(import.meta.resolve("agent-browser/package.json"))),
    "bin",
    "agent-browser.js",
);
/** Applies when a session's daemon starts: it closes its Chrome after this long without a command. */
const IDLE = "30m";

/** The agent-browser session of a conversation: its own daemon, Chrome and stream port. */
export const sessionOf = (conversationId: number): string => `pda-${conversationId}`;

/**
 * Runs one command in `session` and returns its `data`; a refused command throws its `error`. A command that
 * started the session's Chrome sizes it as extensions/browser does: agent-browser's own default is 1280×577.
 */
export async function run(
    session: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
    const data = await once(session, args, options);

    if (recordOf(data["lifecycle"])?.["launched"] === true) {
        await once(session, ["set", "viewport", "1280", "800", "1"], options);
    }

    return data;
}

function once(
    session: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<Record<string, unknown>> {
    return new Promise((done, fail) => {
        execFile(
            process.execPath,
            [LAUNCHER, "--session", session, "--idle-timeout", IDLE, "--json", ...args],
            {
                timeout: options.timeoutMs ?? 60_000,
                maxBuffer: 64 * 1024 * 1024,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
            (error, stdout) => {
                // A refused command exits 1 and still prints its JSON answer.
                const answer = parse(stdout);

                if (answer === undefined) {
                    fail(
                        new Error(error === null ? "agent-browser said nothing" : messageOf(error)),
                    );
                } else if (answer.success === true) {
                    done(recordOf(answer.data) ?? {});
                } else {
                    fail(
                        new Error(
                            typeof answer.error === "string"
                                ? answer.error
                                : "agent-browser failed",
                        ),
                    );
                }
            },
        );
    });
}

function parse(stdout: string): { success?: unknown; data?: unknown; error?: unknown } | undefined {
    try {
        return recordOf(JSON.parse(stdout));
    } catch {
        return undefined;
    }
}
