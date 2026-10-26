import type { ComponentType, ReactNode } from "react";

export type StatusProps = {
    session: { id: number; cwd: string | null; busy: boolean } | null;
};

export type StatusItem = {
    id: string;
    slot: "start" | "center" | "end";
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

/** What a folder's `web.tsx` default-exports. */
export type WebExtension = {
    status?: StatusItem[];
    settings?: SettingsSection[];
    panels?: PanelItem[];
};
