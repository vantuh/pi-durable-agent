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
    /** How much of `input` the provider served from its cache. */
    cached: number;
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
    | {
          /**
           * Where a compaction cut the active context: everything above it was summarized, and the summary is here.
           * The entries above are still the conversation, they are just no longer what the model is sent.
           */
          id: number;
          kind: "compaction";
          summary?: string;
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

/** One field an extension adds to a status place; it exists only while that extension is installed. */
export type ClientStatus = {
    /** The folder name of the extension that wrote it. */
    source: string;
    /**
     * Where it sits. `start`, `center`, `end`: the status bar, for what is about the app. `composer`: beside the
     * model chip, for what one conversation used. `title`: a small line under the conversation's title.
     */
    slot: "start" | "center" | "end" | "composer" | "title";
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
    /** What was typed, not the expansion the agent reads, so it can go back into the composer as it was. */
    text: string;
    files?: ClientAttachment[];
};

export type ClientLive = {
    busy: boolean;
    /** The answer being streamed now, before it is committed as an entry. */
    blocks?: ClientBlock[];
    /** Unix milliseconds when the streamed answer's request started. */
    startedAt?: number;
    tools?: ClientTool[];
    /** A compaction is running now: the model is being handed a summary of what came before. */
    compacting?: boolean;
    /** That compaction's last attempt failed and it waits before trying again. */
    compactionRetrying?: boolean;
    /** The newest failure since a compaction last succeeded: what came before is still what is sent. */
    compactionFailed?: { error: string };
    usage: ClientUsage;
    queued?: ClientQueued[];
    status?: ClientStatus[];
};

/**
 * Older entries, as `GET /api/history` answers them: the durable transcript, oldest of the page first. The event
 * stream only carries the active view, which starts at the newest compaction; this is how the start is reached.
 */
export type ClientHistory = {
    entries: ClientEntry[];
    /** Older entries exist: ask again with this page's first id as `before`. */
    more: boolean;
};

export type ExtensionNotice = { level: "success" | "error"; message: string };

export type ServerEvent = { session: number } & (
    | {
          type: "hello";
          entries: ClientEntry[];
          live: ClientLive;
          model: string;
          /** The log holds entries older than these, so the screen has a start still to ask for. */
          more: boolean;
      }
    /** `replace` says the server rewrote the active view; the browser adds by id either way, it never swaps. */
    | { type: "entries"; entries: ClientEntry[]; replace: boolean }
    | { type: "live"; live: ClientLive }
    | { type: "extension-notice"; notice: ExtensionNotice }
    | { type: "error"; message: string }
);

/** One row of the session list. */
export type SessionSummary = {
    id: number;
    archived: boolean;
    /** The name set by hand; null while the first question still names the session. */
    name: string | null;
    title: string | null;
    cwd: string | null;
    model: string | null;
    thinkingLevel: string | null;
    busy: boolean;
    /**
     * What the row says instead of the working pulse, from an extension that holds the session;
     * absent when nothing does. The browser draws it as a mark, with `title` and `aria-label`.
     */
    mark?: string;
    /** When a person last wrote to the session, or created it; null while unknown. */
    activeAt: number | null;
    /** A run ended after the session was last seen, on any device; never while it works or is archived. */
    unseen: boolean;
};

/** What `GET /api/sessions/events` sends: the whole list, at once and after every change. */
export type SessionsEvent = { type: "sessions"; sessions: SessionSummary[] };

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

/** What a slash command did: `empty` means there was nothing for it to do, and the screen says so. */
export type CommandResult = { status: "started" } | { status: "empty" };

/** The model and thinking level a new session starts with. */
export type DefaultModel = {
    provider: string;
    modelId: string;
    thinkingLevel: string;
};
