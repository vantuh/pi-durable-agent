import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode, RefObject } from "react";

import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";

export type StatusProps = {
    session: {
        id: number;
        cwd: string | null;
        busy: boolean;
        /** `provider/modelId` of the conversation's agent, or null when the server has not said. */
        model: string | null;
    } | null;
};

export type StatusItem = {
    id: string;
    /** The same places as a server field's `slot`. */
    slot: ClientStatus["slot"];
    /** A plain function component: a `memo` or `forwardRef` object is rejected. */
    component: ComponentType<StatusProps>;
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
