import { actionRef } from "../../shared/extension-api.ts";

export const DEFAULT_VERSION = "2.1.280";
export type ShapeOutcome =
    | "applied"
    | "other-provider"
    | "not-oauth"
    | "already-shaped"
    | "no-user-text";
export type Diagnostics = {
    version: string;
    source: "default" | "environment";
    last: { outcome: ShapeOutcome; provider: string; at: number } | null;
};

export const outcomes: Record<ShapeOutcome, string> = {
    applied: "Shaping applied",
    "other-provider": "Skipped: other provider",
    "not-oauth": "Skipped: not an OAuth request",
    "already-shaped": "Skipped: billing block already present",
    "no-user-text": "Skipped: no first-user text",
};

export const diagnostics = actionRef<undefined, Diagnostics>(
    "anthropic-subscription",
    "diagnostics",
    (value) => {
        if (typeof value !== "object" || value === null) {
            throw new Error("Invalid diagnostics");
        }
        const version: unknown = Reflect.get(value, "version");
        const source: unknown = Reflect.get(value, "source");
        const last: unknown = Reflect.get(value, "last");
        if (typeof version !== "string" || (source !== "default" && source !== "environment")) {
            throw new Error("Invalid diagnostics version");
        }
        if (last === null) {
            return { version, source, last };
        }
        if (typeof last !== "object") {
            throw new Error("Invalid last request");
        }
        const outcome: unknown = Reflect.get(last, "outcome");
        const provider: unknown = Reflect.get(last, "provider");
        const at: unknown = Reflect.get(last, "at");
        if (
            typeof outcome !== "string" ||
            !Object.hasOwn(outcomes, outcome) ||
            typeof provider !== "string" ||
            typeof at !== "number" ||
            !Number.isFinite(at)
        ) {
            throw new Error("Invalid last request");
        }
        // Checked against the closed outcomes record above.
        const checked = Object.keys(outcomes).find((key): key is ShapeOutcome => key === outcome);
        if (checked === undefined) {
            throw new Error("Unknown outcome");
        }
        return { version, source, last: { outcome: checked, provider, at } };
    },
);
