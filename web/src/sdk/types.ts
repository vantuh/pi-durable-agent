import type { ComponentType } from "react";

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

/** What a folder's `web.tsx` default-exports. */
export type WebExtension = { status?: StatusItem[]; settings?: SettingsSection[] };
