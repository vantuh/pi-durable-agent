/**
 * The transcript as the screen shows it: one turn per person's message, and in each turn Pi's thinking and tool
 * calls folded into activity groups between its words. A group goes on across answers until words end it, so the
 * calls Pi made one after another read as one line. The shape follows Pi Pocket's `web/turns.js`.
 */

import type { ClientEntry, ClientLive, ClientTool } from "../../../shared/protocol.ts";
import { diffCounts } from "./diff.ts";

type UserEntry = Extract<ClientEntry, { kind: "user" }>;
type AnswerEntry = Extract<ClientEntry, { kind: "assistant" }>;
type ResultEntry = Extract<ClientEntry, { kind: "toolResult" }>;

/** `stopped`: the call has no result and never will — its answer was stopped or failed. */
export type StepStatus = "pending" | "running" | "done" | "error" | "stopped";

export type Step =
    | { kind: "thinking"; key: string; text: string; streaming: boolean }
    | {
          kind: "tool";
          key: string;
          id: string;
          name: string;
          args: unknown;
          status: StepStatus;
          result?: ResultEntry;
      };

export type Item =
    | {
          type: "activity";
          key: string;
          steps: Step[];
          live: boolean;
          startedAt?: number;
          endedAt?: number;
      }
    | { type: "reply"; key: string; text: string; streaming: boolean }
    | { type: "error"; key: string; text: string };

export type TurnStats = {
    model: string;
    thinkingLevel?: string;
    responses: number;
    /** The newest response's prompt: the context the turn has grown to. */
    context: number;
    output: number;
    cost: number;
    startedAt?: number;
    endedAt?: number;
};

export type Turn = {
    key: string;
    user?: UserEntry;
    items: Item[];
    live: boolean;
    stats?: TurnStats;
};

const DID: Record<string, { verb: string; noun?: string; by?: string }> = {
    read: { verb: "read", noun: "file", by: "path" },
    edit: { verb: "edited", noun: "file", by: "path" },
    write: { verb: "wrote", noun: "file", by: "path" },
    bash: { verb: "ran", noun: "command" },
    grep: { verb: "searched" },
    find: { verb: "searched" },
    ls: { verb: "listed", noun: "folder", by: "path" },
};

export function argOf(args: unknown, key: string): string | undefined {
    if (typeof args !== "object" || args === null || !(key in args)) {
        return undefined;
    }

    const value: unknown = Reflect.get(args, key);

    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** The one argument that says what a call was about: its path, command, or pattern. */
export function subjectOf(name: string, args: unknown): string | undefined {
    for (const key of ["path", "command", "pattern", "url", "query", "name"]) {
        const value = argOf(args, key);

        if (value !== undefined && value !== "") {
            return name === "bash" ? value.split("\n")[0] : value;
        }
    }

    return undefined;
}

const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length);

const plural = (count: number, noun: string): string =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** Lines an edit put in and took out, from its `edits` argument. */
function editCounts(args: unknown): { added: number; removed: number } | undefined {
    const edits: unknown =
        typeof args === "object" && args !== null ? Reflect.get(args, "edits") : undefined;

    if (!Array.isArray(edits)) {
        return undefined;
    }

    let added = 0;
    let removed = 0;

    for (const each of edits) {
        added += lineCount(argOf(each, "newText") ?? "");
        removed += lineCount(argOf(each, "oldText") ?? "");
    }

    return { added, removed };
}

/** Commands that run tests, by the words in them. */
const TESTS = /\b(?:test|tests|spec|jest|vitest|pytest|mocha|ava|tap|rspec|phpunit|ctest)\b/i;

/**
 * A test run's outcome from what it printed, as in "48 passed · 1 failed · 3.1s": for a command that runs tests, or
 * output with a runner's own summary. After Pi Pocket's `testOutcome` (`web/turns.js`, MIT).
 */
export function testOutcome(
    text: string,
    command: string,
): { text: string; passed: number; failed: number } | undefined {
    if (!TESTS.test(command) && !/^(?:# pass|ℹ pass|Tests:) /m.test(text)) {
        return undefined;
    }

    // Node's own count first ("ℹ pass 48"), then Jest's and Vitest's line for tests ("Tests: 1 failed, 47 passed"),
    // then any "N passed" or "N passing".
    const count = (node: string, word: string): number | undefined => {
        const found =
            new RegExp(`^(?:#|ℹ) ${node} (\\d+)`, "m").exec(text)?.[1] ??
            new RegExp(`^\\s*Tests:?\\s+(?:[^\\n]*?\\D)?(\\d+) ${word}`, "m").exec(text)?.[1] ??
            new RegExp(
                `\\b(\\d+) (?:${word}|${word === "passed" ? "passing" : "failing"})\\b`,
            ).exec(text)?.[1];

        return found === undefined ? undefined : Number(found);
    };
    const passed = count("pass", "passed");

    if (passed === undefined) {
        return undefined;
    }

    const failed = count("fail", "failed") ?? 0;
    const ms = /duration_ms ([\d.]+)/.exec(text)?.[1];
    const seconds =
        ms === undefined
            ? Number(/\b(?:in|Duration|Time:)\s+([\d.]+)\s?s\b/.exec(text)?.[1] ?? Number.NaN)
            : Number(ms) / 1000;
    const parts = [
        `${String(passed)} passed`,
        ...(failed > 0 ? [`${String(failed)} failed`] : []),
        ...(Number.isFinite(seconds)
            ? [seconds < 10 ? `${seconds.toFixed(1)}s` : `${String(Math.round(seconds))}s`]
            : []),
    ];

    return { text: parts.join(" · "), passed, failed };
}

/** What a finished call came to, on the right of its line: "89 lines", "+3 −1", "no output". */
export function outcomeOf(
    step: Extract<Step, { kind: "tool" }>,
):
    | { text: string; tone?: "ok" | "danger"; counts?: { added: number; removed: number } }
    | undefined {
    const result = step.result;

    if (result === undefined) {
        return step.status === "stopped" ? { text: "did not run" } : undefined;
    }

    const text = result.text.trim();
    const tests =
        step.name === "bash" ? testOutcome(text, argOf(step.args, "command") ?? "") : undefined;

    // Before the error: a run whose tests failed exits non-zero, and its counts say more than its exit code.
    if (tests !== undefined) {
        return { text: tests.text, tone: tests.failed > 0 || result.isError ? "danger" : "ok" };
    }

    if (result.isError) {
        if (/\b(?:aborted|interrupted)\b/i.test(text)) {
            return { text: "stopped", tone: "danger" };
        }

        // Not the harness's own tags around its errors ("<harness>"), nor its "[error]".
        const first =
            text
                .split("\n")
                .map((line) => line.trim().replace(/^\[[\w -]+\]\s*/, ""))
                .find((line) => line !== "" && !/^<\/?[\w-]+>$/.test(line)) ?? "failed";

        return { text: first.length > 48 ? `${first.slice(0, 47)}…` : first, tone: "danger" };
    }

    // A cut output cannot be counted.
    const counted = result.truncated === true ? undefined : lineCount(text);

    switch (step.name) {
        case "edit": {
            const counts =
                result.diff === undefined ? editCounts(step.args) : diffCounts(result.diff);

            return counts === undefined
                ? undefined
                : {
                      text: `+${String(counts.added)} −${String(counts.removed)}`,
                      tone: "ok",
                      counts,
                  };
        }

        case "write": {
            const content = argOf(step.args, "content");

            return content === undefined
                ? undefined
                : { text: `+${String(lineCount(content))}`, tone: "ok" };
        }

        case "read":
        case "bash":
            return counted === undefined
                ? { text: "long output" }
                : { text: counted === 0 ? "no output" : plural(counted, "line") };

        case "grep":
            return /^No matches/.test(text)
                ? { text: "no matches" }
                : {
                      text:
                          counted === undefined
                              ? "many matches"
                              : plural(counted, "match").replace("matchs", "matches"),
                  };

        case "find":
        case "ls":
            return {
                text:
                    counted === undefined
                        ? "many"
                        : plural(counted, step.name === "ls" ? "entry" : "file").replace(
                              "entrys",
                              "entries",
                          ),
            };

        default:
            return undefined;
    }
}

/** "Thought, read 2 files and ran 3 commands": each kind of step once, in the order Pi first did it. */
export function summarize(steps: Step[], thinking: boolean): string {
    const did = new Map<string, Map<string, Set<string>>>();

    for (const step of steps) {
        const kind =
            step.kind === "thinking"
                ? { verb: "thought" }
                : (DID[step.name] ?? { verb: `used ${step.name}` });
        const nouns = did.get(kind.verb) ?? new Map<string, Set<string>>();

        did.set(kind.verb, nouns);

        if (step.kind === "tool" && kind.noun !== undefined) {
            const things = nouns.get(kind.noun) ?? new Set<string>();
            const by = kind.by === undefined ? undefined : argOf(step.args, kind.by);

            things.add(by ?? step.id);
            nouns.set(kind.noun, things);
        }
    }

    const parts = [...did].map(([verb, nouns]) => {
        const said = verb === "thought" && thinking && did.size === 1 ? "thinking" : verb;
        const counted = [...nouns].map(
            ([noun, things]) => `${String(things.size)} ${noun}${things.size === 1 ? "" : "s"}`,
        );

        return counted.length === 0 ? said : `${said} ${counted.join(", ")}`;
    });
    const last = parts.pop() ?? "";
    const line = parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;

    return line.charAt(0).toUpperCase() + line.slice(1);
}

function statusOf(
    id: string,
    result: ResultEntry | undefined,
    running: Map<string, ClientTool>,
    canRun: boolean,
): StepStatus {
    if (result !== undefined) {
        return result.isError ? "error" : "done";
    }

    const tool = running.get(id);

    if (tool !== undefined) {
        return tool.status === "done" ? "done" : tool.status;
    }

    return canRun ? "pending" : "stopped";
}

/** When an answer's request ended, or started when it has no duration. */
const answerEnd = (entry: AnswerEntry): number | undefined =>
    entry.stats === undefined ? undefined : entry.stats.startedAt + (entry.stats.durationMs ?? 0);

/** A group ends at the latest time any of its steps reports. */
function reach(group: Extract<Item, { type: "activity" }>, at: number | undefined): void {
    if (at !== undefined) {
        group.endedAt = Math.max(group.endedAt ?? at, at);
    }
}

export function turnsOf(entries: ClientEntry[], live: ClientLive): Turn[] {
    const results = new Map<string, ResultEntry>();
    const running = new Map((live.tools ?? []).map((tool) => [tool.callId, tool]));

    for (const entry of entries) {
        if (entry.kind === "toolResult") {
            results.set(entry.callId, entry);
        }
    }

    const turns: Turn[] = [];
    const answers = new Map<Turn, AnswerEntry[]>();
    let turn: Turn | undefined;
    let group: Extract<Item, { type: "activity" }> | undefined;
    let groups = 0;
    let replies = 0;

    const begin = (user?: UserEntry): Turn => {
        const next: Turn = {
            key: user === undefined ? "t0" : `t${String(user.id)}`,
            items: [],
            live: false,
        };

        if (user !== undefined) {
            next.user = user;
        }

        turns.push(next);
        answers.set(next, []);
        group = undefined;
        groups = 0;
        replies = 0;

        return next;
    };

    // The newest answer's calls can still run while the agent works; any older call without a result never will.
    const lastAnswer = entries.findLast((entry) => entry.kind === "assistant");

    const answer = (
        into: Turn,
        entry: AnswerEntry | undefined,
        blocks: AnswerEntry["blocks"],
        streaming: boolean,
    ) => {
        const canRun = streaming || (live.busy && entry === lastAnswer);
        const startedAt = streaming ? live.startedAt : entry?.stats?.startedAt;

        if (entry !== undefined) {
            answers.get(into)?.push(entry);
        }

        blocks.forEach((block, at) => {
            const growing = streaming && at === blocks.length - 1;

            if (block.type === "text") {
                group = undefined;

                if (block.text.trim() !== "") {
                    into.items.push({
                        type: "reply",
                        key: `${into.key}:r${String(replies++)}`,
                        text: block.text,
                        streaming: growing,
                    });
                }

                return;
            }

            if (group === undefined) {
                group = {
                    type: "activity",
                    key: `${into.key}:a${String(groups++)}`,
                    steps: [],
                    live: false,
                };

                if (startedAt !== undefined) {
                    group.startedAt = startedAt;
                }

                into.items.push(group);
            }

            const key = `${group.key}:${String(group.steps.length)}`;

            if (block.type === "thinking") {
                group.steps.push({ kind: "thinking", key, text: block.text, streaming: growing });
            } else {
                const result = results.get(block.id);
                const status = statusOf(block.id, result, running, canRun);

                group.steps.push({
                    kind: "tool",
                    key,
                    id: block.id,
                    name: block.name,
                    args: block.args,
                    status,
                    ...(result === undefined ? {} : { result }),
                });
                reach(group, result?.at);
            }

            group.live ||= canRun;
            reach(group, entry === undefined ? undefined : answerEnd(entry));
        });

        if (entry?.error !== undefined) {
            group = undefined;
            into.items.push({
                type: "error",
                key: `${into.key}:e${String(entry.id)}`,
                text: entry.error,
            });
        }
    };

    for (const entry of entries) {
        if (entry.kind === "user") {
            turn = begin(entry);
        } else if (entry.kind === "assistant") {
            turn ??= begin();
            answer(turn, entry, entry.blocks, false);
        }
    }

    if (live.blocks !== undefined) {
        turn ??= begin();
        answer(turn, undefined, live.blocks, true);
    }

    const newest = turns.at(-1);

    if (newest !== undefined) {
        newest.live = live.busy;
    }

    for (const each of turns) {
        const stats = statsOf(each, answers.get(each) ?? []);

        if (stats !== undefined) {
            each.stats = stats;
        }
    }

    return turns;
}

function statsOf(turn: Turn, answers: AnswerEntry[]): TurnStats | undefined {
    const measured = answers.flatMap((entry) => (entry.stats === undefined ? [] : [entry]));
    const first = measured[0]?.stats;
    const last = measured.at(-1);

    if (first === undefined || last?.stats === undefined) {
        return undefined;
    }

    const stats: TurnStats = {
        model: last.stats.model,
        responses: measured.length,
        context: last.stats.input,
        output: 0,
        cost: 0,
    };
    const startedAt = turn.user?.at ?? first.startedAt;
    const endedAt = answerEnd(last);

    for (const entry of measured) {
        stats.output += entry.stats?.output ?? 0;
        stats.cost += entry.stats?.cost ?? 0;
    }

    stats.startedAt = startedAt;

    if (endedAt !== undefined && !turn.live) {
        stats.endedAt = endedAt;
    }

    if (last.stats.thinkingLevel !== undefined) {
        stats.thinkingLevel = last.stats.thinkingLevel;
    }

    return stats;
}
