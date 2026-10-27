/**
 * The only contract between the server and the browser. Nothing else crosses: no `pi-durable` types,
 * no document shapes, no entries as the harness stores them.
 */

export type ClientBlock =
    | { type: "text"; text: string }
    | { type: "thinking"; text: string }
    | { type: "toolCall"; id: string; name: string; args: unknown };

/** What one model response cost and how long it took, as the provider reported it. */
export type ClientAnswerStats = {
    model: string;
    thinkingLevel?: string;
    /** `toolUse` means the run goes on after its tools; anything else ends the turn. */
    stopReason: string;
    /** Prompt tokens, cache reads and writes included: the context the response was sent with. */
    input: number;
    output: number;
    cost: number;
    /** Unix milliseconds when the request started. */
    startedAt: number;
    durationMs?: number;
};

export type ClientAttachment = {
    name: string;
    path: string;
    size: number;
    image: boolean;
};

export type ClientEntry =
    | { id: number; kind: "user"; text: string; at?: number; files?: ClientAttachment[] }
    | {
          id: number;
          kind: "assistant";
          blocks: ClientBlock[];
          model?: string;
          error?: string;
          stats?: ClientAnswerStats;
      }
    | {
          id: number;
          kind: "toolResult";
          callId: string;
          name: string;
          text: string;
          isError: boolean;
          truncated?: true;
          at?: number;
          durationMs?: number;
          /** An edit's diff as the tool wrote it: `+12 text`, `-12 text`, ` 12 text`, and `   ...` where lines are skipped. */
          diff?: string;
      }
    | { id: number; kind: "other"; entryKind: string };

export type ClientTool = {
    callId: string;
    name: string;
    status: "pending" | "running" | "done";
    output?: string;
};

/** The conversation's spend so far, summed over every model and tool bucket. */
export type ClientUsage = {
    input: number;
    output: number;
    cost: number;
};

/** One field an extension adds to the status bar; it exists only while that extension is installed. */
export type ClientStatus = {
    /** The folder name of the extension that wrote it. */
    source: string;
    /** Where in the bar it sits: after the folder, in the middle, or at the right end. */
    slot: "start" | "center" | "end";
    text: string;
    /** A word before the meter and the text. */
    label?: string;
    /** A bar between the label and the text: `fill` is 0 to 1. */
    meter?: { fill: number; tone?: "warn" | "danger" };
    title?: string;
};

/** A message waiting in `pi.inbox` until the run reaches the boundary its mode names. */
export type ClientQueued = {
    id: number;
    mode: "steer" | "followUp";
    text: string;
};

export type ClientLive = {
    busy: boolean;
    /** The answer being streamed now, before it is committed as an entry. */
    blocks?: ClientBlock[];
    /** Unix milliseconds when the streamed answer's request started. */
    startedAt?: number;
    tools?: ClientTool[];
    usage: ClientUsage;
    queued?: ClientQueued[];
    status?: ClientStatus[];
};

export type ServerEvent = { session: number } & (
    | { type: "hello"; entries: ClientEntry[]; live: ClientLive; model: string }
    | { type: "entries"; entries: ClientEntry[]; replace: boolean }
    | { type: "live"; live: ClientLive }
    | { type: "error"; message: string }
);

/** One row of the session list. */
export type SessionSummary = {
    id: number;
    archived: boolean;
    title: string | null;
    cwd: string | null;
    model: string | null;
    thinkingLevel: string | null;
    busy: boolean;
    /** When a person last wrote to the session, or created it; null while unknown. */
    activeAt: number | null;
    /** When the latest run ended, on the server's clock; absent until one ends while the server is up. */
    endedAt?: number;
};

/** One model the picker offers. */
export type ModelChoice = {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    reasoning: boolean;
    levels: string[];
};

/** How a message goes while the agent works: after the next tool round, after the answer, or now. */
export type SendMode = "steer" | "followUp" | "interrupt";

/** The model and thinking level a new session starts with. */
export type DefaultModel = {
    provider: string;
    modelId: string;
    thinkingLevel: string;
};
