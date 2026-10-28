/**
 * Kiro: the local `kiro-cli` with its web tools trusted and nothing else. `stream-json` prints the
 * run as JSON Lines; the answer is the message text after the last tool call, because text before a
 * search is narration ("I'll search for…") that the plain output runs into the answer.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { type Found, type Source, record, sourceOf, str, uniqueSources } from "./wire.ts";

export const MAX_OUTPUT = 4 * 1024 * 1024;
const LINK = /https?:\/\/[^\s<>()[\]"']+/g;

/** The answer with its closing `Sources:` list taken off, and the links of that list. */
export function readKiro(output: string): Found {
    let message = "";

    for (const line of output.split("\n")) {
        let event: unknown;

        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }

        const { type, data } = record(event);
        const update = record(record(data)["update"]);

        if (type === "sessionUpdate" && update["sessionUpdate"] === "tool_call") {
            message = "";
        }

        if (type === "sessionUpdate" && update["sessionUpdate"] === "agent_message_chunk") {
            message += str(record(update["content"])["text"]) ?? "";
        }

        if (type === "runFinished" && record(data)["status"] !== "success") {
            throw new Error(`kiro-cli run ended: ${str(record(data)["status"]) ?? "unknown"}`);
        }
    }

    const text = message.trim();
    const lines = text.split("\n");
    const marker = lines.findLastIndex((line) => /^\W*sources?\W*$/i.test(line));
    const head = marker === -1 ? text : lines.slice(0, marker).join("\n").trim();
    const tail = marker === -1 ? text : lines.slice(marker + 1).join("\n");
    const sources: Source[] = (tail.match(LINK) ?? []).map((link) => {
        return sourceOf(link.replace(/[.,;:]+$/, ""));
    });

    if (head === "") {
        throw new Error("kiro-cli printed no answer");
    }

    return { answer: head, sources: uniqueSources(sources), model: "kiro-cli" };
}

/**
 * Runs `kiro-cli` and returns its stdout. `kiro-cli` is a wrapper that starts `kiro-cli-chat` and
 * leaves the work to it, so the process is started as a group leader and the kill goes to the whole
 * group: SIGTERM to the wrapper alone (what `execFile`'s `signal` sends) can be ignored, and a
 * SIGKILL to it alone leaves the child running with the pipe open.
 */
function runKiro(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn("kiro-cli", args, {
            cwd,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const out: Buffer[] = [];
        let size = 0;
        let stderr = "";
        let failure: Error | undefined;

        const stop = () => {
            // Without a pid nothing started (kiro-cli is missing); a pid of 0 would address our own group.
            if (child.pid === undefined) {
                return;
            }

            try {
                // The group id is the child's pid; a negative pid addresses the group.
                process.kill(-child.pid, "SIGKILL");
            } catch {
                // The group is already gone, which is what was asked for.
            }
        };

        signal.addEventListener("abort", stop, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
            size += chunk.length;
            out.push(chunk);

            if (size > MAX_OUTPUT && failure === undefined) {
                failure = new Error("kiro-cli output too large");
                stop();
            }
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-2000);
        });
        child.once("error", (error) => {
            signal.removeEventListener("abort", stop);
            reject(
                "code" in error && error.code === "ENOENT"
                    ? new Error("kiro-cli is not installed", { cause: error })
                    : error,
            );
        });
        // "close" comes after every process holding the pipe has gone, so nothing outlives the call.
        child.once("close", (code) => {
            signal.removeEventListener("abort", stop);
            stop();

            if (signal.aborted) {
                reject(signal.reason);
            } else if (failure !== undefined) {
                reject(failure);
            } else if (code !== 0) {
                const reason = stripVTControlCharacters(stderr).trim().split("\n").at(-1);

                reject(
                    new Error(
                        `kiro-cli failed${reason === undefined || reason === "" ? "" : `: ${reason}`}`,
                    ),
                );
            } else {
                resolve(Buffer.concat(out).toString());
            }
        });
    });
}

export async function searchKiro(prompt: string, signal: AbortSignal): Promise<Found> {
    signal.throwIfAborted();

    // An empty folder, so nothing in the user's project is loaded as context.
    const cwd = await mkdtemp(join(tmpdir(), "web-search-kiro-"));

    try {
        return readKiro(
            await runKiro(
                [
                    "chat",
                    "--no-interactive",
                    "--output-format=stream-json",
                    "--trust-tools=web_search,web_fetch",
                    prompt,
                ],
                cwd,
                signal,
            ),
        );
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
