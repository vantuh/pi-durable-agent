import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

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

/** A screencast frame's number and CSS size; the JPEG comes from `GET /api/extensions/browser/http/frame`. */
export type Frame = { seq: number; width: number; height: number };

export type LogEntry = { seq: number; at: number; level: string; text: string; source?: string };

export type Control =
    | { op: "open" }
    | { op: "navigate"; url: string }
    | { op: "back" | "forward" | "reload" | "stop" | "clear" }
    | { op: "viewport"; viewport: string };

function parseState(value: unknown): BrowserState {
    if (isRecord(value) && typeof Reflect.get(value, "open") === "boolean") {
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
