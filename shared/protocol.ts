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

export type ClientLive = {
    busy: boolean;
    /** The answer being streamed now, before it is committed as an entry. */
    blocks?: ClientBlock[];
    tools?: ClientTool[];
    usage: ClientUsage;
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

export type SendRequest = {
    text: string;
};
