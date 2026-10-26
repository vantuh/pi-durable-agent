/**
 * The only contract between the server and the browser. Nothing else crosses: no `pi-durable` types,
 * no document shapes, no entries as the harness stores them.
 */

export type ClientBlock =
    | { type: "text"; text: string }
    | { type: "thinking"; text: string }
    | { type: "toolCall"; id: string; name: string; args: unknown };

export type ClientEntry =
    | { id: number; kind: "user"; text: string }
    | { id: number; kind: "assistant"; blocks: ClientBlock[]; model?: string; error?: string }
    | {
          id: number;
          kind: "toolResult";
          callId: string;
          name: string;
          text: string;
          isError: boolean;
          truncated?: true;
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
    text: string;
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
    title: string | null;
    cwd: string | null;
    model: string | null;
    thinkingLevel: string | null;
    branch: string | null;
    busy: boolean;
    /** When a person last wrote to the session, or created it; null while unknown. */
    activeAt: number | null;
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

export type SendRequest = {
    text: string;
    mode?: SendMode;
};
