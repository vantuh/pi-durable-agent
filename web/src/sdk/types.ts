import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode, RefObject } from "react";

import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";

export type StatusProps = {
    session: {
        id: number;
        cwd: string | null;
        busy: boolean;
        /**
         * Moves when an extension's server half said this session changed in a way its entries do
         * not show (`host.notifySessionChanged`); an effect that reads such state lists it as a dependency.
         */
        revision: number;
        /** `provider/modelId` of the conversation's agent, or null when the server has not said. */
        model: string | null;
    } | null;
};

export type StatusItemProps = StatusProps & {
    /** Every session, unfiltered: the sidebar's list leaves out those started from another session. */
    sessions: SessionSummary[];
    /** Opens a session in the app, as a plain click on a link to it does. */
    openSession: (id: number) => void;
};

export type StatusItem = {
    id: string;
    /** The same places as a server field's `slot`. */
    slot: ClientStatus["slot"];
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<StatusItemProps>;
};

/** Plain JSON: the picker carries it from an option to that option's `place`, and does nothing else with it. */
export type NewSessionCollected = { readonly [key: string]: string | number | boolean | null };

export type NewSessionProps = {
    /** The folder picked so far, or null while the list is still being read. */
    cwd: string | null;
    /**
     * What this option wants done with the new session; null for the folder as picked. Call it from an
     * effect or a handler, never while rendering.
     */
    use: (collected: NewSessionCollected | null) => void;
    /**
     * Why this option cannot go ahead: its own `blocked`, or what its `place` threw last time. The
     * option says it next to its own field; the picker holds Open back on `blocked` alone, so a
     * failure worth another try can be retried.
     */
    refused: string | null;
};

/** An option in the new-session folder picker: a checkbox and its own field, and where the session starts. */
export type NewSessionItem = {
    id: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<NewSessionProps>;
    /** Why Open cannot go ahead with this, said in place of nothing; null when it can. */
    blocked?: ((collected: NewSessionCollected | null) => string | null) | undefined;
    /**
     * Runs on Open, for an option that collected something: the folder the session starts in, given the
     * one picked so far. A throw keeps the picker open and says why.
     */
    place: (cwd: string, collected: NewSessionCollected) => Promise<string>;
};

export type SettingsProps = StatusProps;

export type SettingsSection = {
    id: string;
    title: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<SettingsProps>;
};

export type PanelProps = StatusProps & {
    onClose: () => void;
    /** The shell has placed this panel over the conversation instead of in the drawer. */
    expanded: boolean;
    /** A panel that chooses to fill the conversation asks for it here; the shell does the placing. */
    setExpanded: (value: boolean) => void;
};

/** A side panel: a button in the conversation header opens it to the right of the transcript. */
export type PanelItem = {
    id: string;
    title: string;
    icon: ReactNode;
    /** A count on the button's corner: return the number (or text), or null for none. Needs only a session. */
    badge?: ComponentType<StatusProps>;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<PanelProps>;
};

export type PageProps = {
    /** The open conversation: a page is reached inside one, so it is never null. */
    session: NonNullable<StatusProps["session"]>;
    /** The page's own place from the address (`&sub=`), undefined at its root. */
    sub: string | undefined;
    /** Moves the page to another sub-location, adding a history step so Back returns. */
    navigate: (sub: string | undefined) => void;
    /** Back to the conversation. `composer` asks the shell to put the caret in the composer. */
    close: (focus?: "composer") => void;
};

/** A page an extension puts in place of the conversation: a header button opens it at `?page=` in the address. */
export type PageItem = {
    id: string;
    title: string;
    icon: ReactNode;
    /** A count on the button's corner: return the number (or text), or null for none. Needs only a session. */
    badge?: ComponentType<StatusProps>;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<PageProps>;
};

export type HeaderItem = {
    id: string;
    component: ComponentType<StatusProps>;
};

export type ComposerProps = StatusProps & {
    /** The message box. */
    field: RefObject<HTMLTextAreaElement | null>;
    /** Replaces the box's text as typing would, so the draft keeps it. */
    setText: (value: string) => void;
    /** Calls `listener` when the message is sent, just before the box clears. Returns the way to stop. */
    onSent: (listener: () => void) => () => void;
};

/** A control in the composer's row, beside Send. */
export type ComposerItem = {
    id: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<ComposerProps>;
};

export type AboveComposerProps = StatusProps & {
    /** Opens a session in the app, as a plain click on a link to it does. */
    openSession: (id: number) => void;
};

/** A block above the composer, in the column the transcript and composer share. It renders nothing when it has nothing to show. */
export type AboveComposerItem = {
    id: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<AboveComposerProps>;
};

export type SidebarBottomProps = StatusProps & {
    /** Every session, unfiltered: the sidebar's list leaves out those started from another session. */
    sessions: SessionSummary[];
    /** Opens a session in the app, as a plain click on a link to it does; on a phone it closes the drawer. */
    openSession: (id: number) => void;
};

/**
 * A block under the session list in the sidebar, with a drag handle between them. The block sits
 * in a column of bounded height: make its root `flex min-h-0 flex-1 flex-col` and scroll the part
 * that can grow. It renders nothing when it has nothing to show, and then takes no space.
 */
export type SidebarBottomItem = {
    id: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<SidebarBottomProps>;
};

export type StatusRowProps = {
    session: SessionSummary;
    /** Every session, unfiltered. */
    sessions: SessionSummary[];
    /** Closes the status popover and opens a session in the app. */
    openSession: (id: number) => void;
};

/**
 * A marker on a row of the status popover (the list opened from the status bar's "working"
 * count), and optionally the submenu the row opens.
 */
export type StatusRowItem = {
    id: string;
    /**
     * Whether this session's row has the marker. A row that has one is listed even while its session
     * is idle. It runs for every session each time the status bar renders, so keep it a cheap filter.
     */
    has: (session: SessionSummary, sessions: SessionSummary[]) => boolean;
    /**
     * The marker: rendered inside the row's link, between the title and the time, for a session
     * `has` accepted. It is part of the row, so give it no box, border or background of its own, and
     * make it small: the row keeps its height. A plain function component: a `memo` or `forwardRef`
     * object is rejected.
     */
    component: ComponentType<StatusRowProps>;
    /**
     * The content of a submenu opened by the whole row: on hover (Radix's delay), with ArrowRight
     * or Space, and with the first tap on a touch screen. The core renders the Radix menu around it,
     * so its rows are `DropdownMenuItem` from `@/components/ui/dropdown-menu`. A click or Enter on
     * the row itself still opens the session. When several items give a submenu for one row, the
     * first one wins. A plain function component.
     */
    submenu?: ComponentType<StatusRowProps>;
};

/** One session, as a row's menu submenu and a row's marks both see it. */
export type SessionItemProps = {
    session: SessionSummary;
};

/** One item an extension adds to a session row's menu, above the core's own. */
export type SessionMenuItem = {
    id: string;
    /** A fixed label, or one read off the row: a command that turns into its own undo. */
    label: string | ((session: SessionSummary) => string);
    icon?: ReactNode | ((session: SessionSummary) => ReactNode);
    /**
     * Runs for one session; its label stands in a toast while it runs, and the failure's message after.
     * Left out by an item that only opens `submenu`.
     */
    run?: (session: number) => Promise<void>;
    /**
     * A submenu this item opens instead of running: the core renders a Radix submenu around the
     * component, so it supplies rows (`DropdownMenuItem`) and nothing else. A row that calls
     * `preventDefault()` in its `onSelect` keeps the submenu open. Mounted only while it is open.
     */
    submenu?: ComponentType<SessionItemProps>;
};

/**
 * A mark an extension draws on a session row, between the title and the time. It is part of the row:
 * no box, border or background of its own, and small enough that the row keeps its height.
 */
export type SessionRowItem = {
    id: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<SessionItemProps>;
};

/** The mark of a tool the extension registers, on that tool's steps in the transcript. */
export type ToolIcon = {
    /** The tool's name, as the model calls it. */
    id: string;
    icon: LucideIcon;
};

/** How the transcript shows the arguments of a tool the extension registers, in place of their JSON. */
export type ToolView = {
    /** The tool's name, as the model calls it. */
    id: string;
    /** The arguments as the model sent them, unchecked; `null` leaves the JSON in place. */
    args: (args: unknown) => ReactNode;
};

/** What a folder's `web.tsx` default-exports. */
export type WebExtension = {
    status?: StatusItem[];
    newSession?: NewSessionItem[];
    header?: HeaderItem[];
    composer?: ComposerItem[];
    aboveComposer?: AboveComposerItem[];
    sidebarBottom?: SidebarBottomItem[];
    statusRow?: StatusRowItem[];
    settings?: SettingsSection[];
    panels?: PanelItem[];
    pages?: PageItem[];
    tools?: ToolIcon[];
    toolViews?: ToolView[];
    sessionMenu?: SessionMenuItem[];
    sessionRow?: SessionRowItem[];
};

/** A details.tsx component in the Extensions dialog, also available while disabled. */
export type ExtensionDetailsProps = {
    enabled: boolean;
    installed: boolean;
};
