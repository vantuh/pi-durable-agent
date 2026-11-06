/**
 * The transcript as the screen shows it: one turn per person's message, and in each turn Pi's thinking and tool
 * calls folded into activity groups between its words. A group goes on across answers until words end it, so the
 * calls Pi made one after another read as one line. The shape follows Pi Pocket's `web/turns.js`.
 */

import type { ClientEntry, ClientLive, ClientTool } from "../../../shared/protocol.ts";

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

export type ToolStep = Extract<Step, { kind: "tool" }>;

export type TurnStats = {
    model: string;
    thinkingLevel?: string;
    responses: number;
    /** The newest response's prompt: the context the turn has grown to. */
    context: number;
    /** How much of `context` the provider served from its cache. */
    cached: number;
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
    /** The boundary a compaction left: what the model was handed instead of everything above it. */
    compacted?: { summary?: string };
};

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

    const begin = (key: string, user?: UserEntry): Turn => {
        const next: Turn = { key, items: [], live: false };

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
            turn = begin(`t${String(entry.id)}`, entry);
        } else if (entry.kind === "assistant") {
            turn ??= begin("t0");
            answer(turn, entry, entry.blocks, false);
        } else if (entry.kind === "compaction") {
            turn = begin(`c${String(entry.id)}`);
            turn.compacted = entry.summary === undefined ? {} : { summary: entry.summary };
        }
    }

    if (live.blocks !== undefined) {
        turn ??= begin("t0");
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
        cached: last.stats.cached,
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
