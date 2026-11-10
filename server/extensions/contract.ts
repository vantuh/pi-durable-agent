/** What an extension's `server.ts` is handed and may export: the host, its callbacks and the shapes it returns. Types only. */

import type { IncomingMessage, ServerResponse } from "node:http";

import type {
    Api,
    AssistantMessage,
    CacheRetention,
    Message,
    Model,
    ModelThinkingLevel,
    Provider,
    Tool,
} from "@earendil-works/pi-ai";
import type { ConversationDocToken, EntryRecord, JsonObject } from "@earendil-works/pi-durable";

import type { ClientStatus, ExtensionNotice } from "../../shared/protocol.ts";
import type { FetchWrapper, RequestShaper, ResolveModelAuth } from "../model-requests.ts";

/**
 * Given a session's folder, the folder it belongs under in the sidebar's folder menu, or undefined
 * for a folder of its own.
 */
export type FolderGroup = (cwd: string) => Promise<string | undefined>;

/** What an extension's `server.ts` receives. It grows only when a feature needs more. */
export type Host = {
    readonly name: string;
    readonly cwd: string;
    readonly dataDir: string;
    readonly log: (message: string) => void;
    /**
     * Registers cleanup for what this version holds (timers, subscriptions). It runs once, after a
     * newer version replaced this one or the folder went and the tool calls, actions and HTTP
     * requests this version had running have finished; or at once when the server stops.
     */
    readonly onDispose: (dispose: Disposer) => void;
    /**
     * Calls `listener` after every commit of every conversation in this process. It is removed when
     * a newer version replaces this one, when the folder goes or is turned off, and when the server
     * stops. A throw or rejection is logged without data and stops nothing else. A listener of a
     * version that loads later is first called with the newest view of each session, as a baseline.
     */
    readonly onCommit: (listener: CommitListener) => void;
    /**
     * Calls `listener` when a session is deleted, before nothing else holds it: a page or a process a
     * version opened for that session is its to end. It is removed when a newer version replaces this
     * one, when the folder goes or is turned off, and when the server stops. A throw or rejection is
     * logged without data and stops neither the other listeners nor the delete itself.
     */
    readonly onSessionGone: (listener: SessionGoneListener) => void;
    /**
     * Says which folder a session's folder is shown under in the sidebar's folder menu, such as the
     * repository a worktree belongs to; undefined leaves it a folder of its own. A throw or
     * rejection counts as "a folder of its own". It goes with this extension version.
     */
    readonly folderGroup: (resolve: FolderGroup) => void;
    /** Shapes provider payloads; removed with this extension version. */
    readonly shapeModelRequests: (shape: RequestShaper) => void;
    /** Wraps the resolved HTTP transport; never retain or log authorization headers. */
    readonly wrapModelFetch: (wrap: FetchWrapper) => void;
    /**
     * Puts a provider in front of the model picker and the harness, and returns how to take it out
     * again. It goes with this extension version, so a reload holds the newest one only.
     */
    readonly registerModelProvider: (provider: Provider) => () => void;
    /** Resolves current provider auth through Pi, including refresh. Never persist or log it. */
    readonly resolveModelAuth: ResolveModelAuth;
    /** The context window of a model in the catalog, in tokens. */
    readonly contextWindow: (provider: string, modelId: string) => number | undefined;
    /** The installed extension whose tools include `tool`; undefined for core tools and unknown names. */
    readonly toolOwner: (tool: string) => string | undefined;
    /**
     * What one conversation would send next and one request on top of it, for keeping its provider
     * cache warm without adding to its transcript. Undefined for a session the server does not know.
     */
    readonly sessionRequest: (session: number) => Promise<SessionRequest | undefined>;
    /**
     * The system prompt sections and tools an empty session's first request will carry, rendered as
     * generation renders them: no entry is written and no model is called. Undefined for a session with
     * entries, one the server does not know, one with no model chosen, or one whose model is not in the
     * catalog.
     */
    readonly sessionPrompt: (session: number) => Promise<SessionPrompt | undefined>;
    /**
     * The entries the conversation's next request is built from: its newest head marker, then everything since.
     * A commit listener's `entries` is only the view's window, the newest 50 to 100, so this is the way to read
     * the whole of it. Undefined for a session the server does not know.
     */
    readonly sessionContext: (session: number) => Promise<readonly EntryRecord[] | undefined>;
    /**
     * The name the sidebar shows for a session, as the owner set it or as its first question gives
     * it; null while it has neither. The core owns titles, so an extension that shows a session asks.
     */
    readonly sessionTitle: (session: number) => Promise<string | null>;
    /**
     * The name someone gave a session, by hand or through an extension; null while it has none. The
     * first question the sidebar falls back to is not a name: it is what an unnamed session shows.
     */
    readonly sessionName: (session: number) => Promise<string | null>;
    /**
     * The conversation that started this one, read from the conversation record: immutable, and it does not
     * depend on commit publication, which a child's first request can outrun.
     */
    readonly sessionOwner: (session: number) => Promise<number | undefined>;
    /**
     * Whether a person saw the session after its latest run ended: a browser says so while the
     * session is on screen, visible and focused. False for a run nobody has looked at yet.
     */
    readonly sessionSeen: (session: number) => Promise<boolean>;
    /** Whether the session's own run is busy, or any session started from it, at any depth, still works. */
    readonly sessionWorking: (session: number) => Promise<boolean>;
    /** Names a session: the sidebar shows it from then on, and an empty title goes back to the first question. */
    readonly setSessionTitle: (session: number, title: string) => Promise<void>;
    /**
     * Moves a session to another folder: the next request of its agent runs there, and its history
     * stays. The caller checks that the folder is right and that the session is not working.
     */
    readonly setSessionCwd: (session: number, cwd: string) => Promise<void>;
    /**
     * The current value of a conversation document, or its initial value while that conversation has
     * none. It is for the places a tool call's `api.snapshot` does not reach: a commit listener and an
     * action. It only reads: no document is created and no revision moves.
     */
    readonly readDoc: <T extends JsonObject>(
        doc: ConversationDocToken<T>,
        session: number,
    ) => Promise<Readonly<T>>;
    /**
     * What the session's row says instead of the working pulse, for as long as this version is
     * installed; `undefined` takes it back. Dropped with the version that set it.
     */
    readonly setSessionMark: (session: number, mark: string | undefined) => void;
    /**
     * Says that something about a session changed which its own commits do not show, such as a
     * conversation this extension started on its behalf. The browsers showing it learn within a
     * moment, through `session.revision`; many calls in that moment make one change.
     */
    readonly notifySessionChanged: (session: number) => void;
    /**
     * Shows a notice in every open browser, whatever session it shows. With `session` it is that
     * session's own toast, whose title opens it; a browser showing that session now stays silent.
     */
    readonly notify: (notice: ExtensionNotice) => void;
};

/** What one request on top of a conversation may ask for beyond its own messages. */
export type SessionSendOptions = {
    /** Stands in for the conversation's system messages; absent sends none of its own. */
    readonly systemPrompt?: string;
    readonly maxTokens?: number;
    /** Defaults to the long cache a conversation's own requests use. */
    readonly cacheRetention?: CacheRetention;
    readonly sessionId?: string;
    /** Absent inherits the conversation's level; "off" explicitly disables thinking. */
    readonly reasoning?: ModelThinkingLevel;
};

/** One conversation's next request: the model, the context it would send, and one request on top. */
export type SessionRequest = {
    readonly model: Model<Api>;
    /** The model context of the next request, its system messages included. */
    readonly messages: readonly Message[];
    /** One request with these messages on the long cache; nothing reaches the transcript. */
    readonly send: (
        messages: readonly Message[],
        signal: AbortSignal,
        options?: SessionSendOptions,
    ) => Promise<AssistantMessage>;
};

/**
 * An empty conversation's system prompt and tool set for its first request. Reading it writes nothing and
 * sends nothing.
 */
export type SessionPrompt = {
    /** The model the first request would use. */
    readonly model: Model<Api>;
    /** The sections the request would carry, in order, tagged as generation tags them. */
    readonly sections: readonly { readonly key: string; readonly text: string }[];
    /** The tool declarations the request would offer, in order. */
    readonly tools: readonly Tool[];
};

/** A session as an extension sees it. `owner` is the session that started it, when a person did not. */
export type SessionRef = {
    readonly id: number;
    readonly cwd: string | null;
    readonly owner?: number;
};

/** One conversation after a commit: what a commit listener may read. */
export type CommitView = {
    readonly session: SessionRef;
    /** The view's window: the newest 50 entries, up to 100 before it is trimmed, not the whole conversation. */
    readonly entries: readonly EntryRecord[];
    readonly busy: boolean;
};

export type CommitListener = (view: CommitView) => void | Promise<void>;

/** Told when a session is deleted, so a version can let go of what it held for it. */
export type SessionGoneListener = (session: number) => void | Promise<void>;

export type Disposer = () => void | Promise<void>;

/** What a status provider reads: the conversation's active entries. */
export type StatusView = {
    readonly entries: readonly EntryRecord[];
    /** The context window of a model in the catalog, in tokens. */
    readonly contextWindow: (provider: string, modelId: string) => number | undefined;
};

/**
 * A folder's optional named export `status`. It runs on every commit and returns one field for the
 * status bar (slot `end` unless it names one), or nothing when it has no honest number to show.
 */
export type StatusLine = Omit<ClientStatus, "source" | "slot"> & { slot?: ClientStatus["slot"] };

export type StatusProvider = (view: StatusView) => StatusLine | undefined;

/** What an action receives. `args` is whatever the browser sent: the action validates it. */
export type ActionCall = {
    readonly args: unknown;
    /** The session the call was made from, or null when it was made from none. */
    readonly session: SessionRef | null;
};

/** A folder's entry in its `actions` export. Its return value must be JSON-serialisable. */
export type Action = (call: ActionCall) => unknown;

/** The `actions` export: the record itself, or a function of the host when actions need its paths. */
export type ActionsExport = Record<string, Action> | ((host: Host) => Record<string, Action>);

/** Raw HTTP under /api/extensions/:name/http/*; needed for HTML, binary bodies and SSE. */
export type HttpHandler = (call: {
    request: IncomingMessage;
    response: ServerResponse;
    /** The namespace-relative path, including its query string. */
    path: string;
}) => void | Promise<void>;

export type LoadFailure = { folder: string; reason: string };

/**
 * A folder's optional named export `meta`: what the owner sees in the list of extensions. `toggle`
 * also puts a switch for the folder in the Settings panel, on or off.
 */
export type ExtensionMeta = { title: string; description: string; toggle?: true };

/** One folder as the owner sees it. `error` is why the last load failed, if it did. */
export type ExtensionInfo = ExtensionMeta & {
    name: string;
    enabled: boolean;
    installed: boolean;
    error?: string;
};
