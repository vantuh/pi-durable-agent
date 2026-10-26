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

export type ClientLive = {
    busy: boolean;
    /** The answer being streamed now, before it is committed as an entry. */
    blocks?: ClientBlock[];
    tools?: ClientTool[];
};

export type ServerEvent =
    | { type: "hello"; entries: ClientEntry[]; live: ClientLive; model: string }
    | { type: "entries"; entries: ClientEntry[]; replace: boolean }
    | { type: "live"; live: ClientLive }
    | { type: "error"; message: string };

export type SendRequest = {
    text: string;
};
