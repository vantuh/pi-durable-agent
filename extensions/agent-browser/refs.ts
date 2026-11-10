import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

export type Stream = { port: number | null; connected: boolean };

export type Control =
    | { op: "open" }
    | { op: "navigate"; url: string }
    | { op: "back" | "forward" | "reload" }
    | { op: "viewport"; viewport: string };

/** The session's agent-browser stream port; asking starts its daemon. */
export const stream = actionRef<undefined, Stream>("agent-browser", "stream", (value) => {
    if (isRecord(value) && typeof value["connected"] === "boolean") {
        const port = value["port"];

        return { port: typeof port === "number" ? port : null, connected: value["connected"] };
    }

    throw new Error("not a stream status");
});

/** What a person does from the toolbar. */
export const control = actionRef<Control, true>("agent-browser", "control", () => true);
