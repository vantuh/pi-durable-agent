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
};

export type StatusItem = {
    id: string;
    /** The same places as a server field's `slot`. */
    slot: ClientStatus["slot"];
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<StatusItemProps>;
};

export type SettingsProps = StatusProps;

export type SettingsSection = {
    id: string;
    title: string;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<SettingsProps>;
};

export type PanelProps = StatusProps & { onClose: () => void };

/** A side panel: a button in the conversation header opens it to the right of the transcript. */
export type PanelItem = {
    id: string;
    title: string;
    icon: ReactNode;
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<PanelProps>;
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

/** One item an extension adds to a session row's menu, above the core's own. */
export type SessionMenuItem = {
    id: string;
    /** A fixed label, or one read off the row: a command that turns into its own undo. */
    label: string | ((session: SessionSummary) => string);
    icon?: ReactNode | ((session: SessionSummary) => ReactNode);
    /** Runs for one session; its label stands in a toast while it runs, and the failure's message after. */
    run: (session: number) => Promise<void>;
};

/** The mark of a tool the extension registers, on that tool's steps in the transcript. */
export type ToolIcon = {
    /** The tool's name, as the model calls it. */
    id: string;
    icon: LucideIcon;
};

/** What a folder's `web.tsx` default-exports. */
export type WebExtension = {
    status?: StatusItem[];
    header?: HeaderItem[];
    composer?: ComposerItem[];
    aboveComposer?: AboveComposerItem[];
    sidebarBottom?: SidebarBottomItem[];
    statusRow?: StatusRowItem[];
    settings?: SettingsSection[];
    panels?: PanelItem[];
    tools?: ToolIcon[];
    sessionMenu?: SessionMenuItem[];
};

/** A details.tsx component in the Extensions dialog, also available while disabled. */
export type ExtensionDetailsProps = {
    enabled: boolean;
    installed: boolean;
};
