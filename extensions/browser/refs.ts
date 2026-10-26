import { actionRef } from "../../shared/extension-api.ts";

export type Viewport = { width: number; height: number; scale: number; mobile: boolean };

export type BrowserState = {
    available: boolean;
    open: boolean;
    url: string;
    title: string;
    loading: boolean;
    viewport: Viewport;
    preset?: "mobile" | "tablet" | "desktop";
    canGoBack: boolean;
    canGoForward: boolean;
    errors: number;
    logs: number;
    problem?: string;
};

export type Frame = { seq: number; width: number; height: number; image: string };

export type LogEntry = { seq: number; at: number; level: string; text: string; source?: string };

export type Control =
    | { op: "open" }
    | { op: "navigate"; url: string }
    | { op: "back" | "forward" | "reload" | "stop" | "clear" }
    | { op: "viewport"; viewport: string };

function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function parseState(value: unknown): BrowserState {
    if (isObject(value) && typeof Reflect.get(value, "open") === "boolean") {
        // The server built it from `BrowserPage.state`; the fields are not re-checked one by one.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as BrowserState;
    }

    throw new Error("not a browser state");
}

/** The page of the session as it is now. */
export const state = actionRef<undefined, BrowserState>("browser", "state", parseState);

/** What a person does to the page: open, go somewhere, back, forward, reload, stop, resize. */
export const control = actionRef<Control, BrowserState>("browser", "control", parseState);

/** The next screencast frame after `after`, as base64 JPEG; waits up to 25 seconds. Null: none came. */
export const frame = actionRef<{ after: number }, Frame | null>("browser", "frame", (value) => {
    if (value === null) {
        return null;
    }

    if (isObject(value) && typeof Reflect.get(value, "image") === "string") {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as Frame;
    }

    throw new Error("not a frame");
});

/** Taps, drags, wheel, keys and text at CSS pixels of the viewport, in order. */
export const input = actionRef<{ events: readonly unknown[] }, true>(
    "browser",
    "input",
    () => true,
);

export const logs = actionRef<undefined, LogEntry[]>("browser", "logs", (value) => {
    if (Array.isArray(value)) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as LogEntry[];
    }

    throw new Error("not a list of log lines");
});
