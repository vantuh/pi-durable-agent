import { actionRef } from "../../shared/extension-api.ts";

export const DEFAULT_VERSION = "2.1.280";
export type ShapeOutcome =
    | "applied"
    | "other-provider"
    | "not-oauth"
    | "already-shaped"
    | "no-user-text";
export type VersionError = { requiredVersion: string | null; hint: string; at: number };
export type Diagnostics = {
    version: string;
    source: "default" | "environment" | "transport" | "server-required";
    learnedFloor: string | null;
    lastRetry: "none" | "recovered" | "failed";
    transportVersion: string | null;
    versionError: VersionError | null;
    last: { outcome: ShapeOutcome; provider: string; at: number } | null;
};

export const outcomes: Record<ShapeOutcome, string> = {
    applied: "Shaping applied",
    "other-provider": "Skipped: other provider",
    "not-oauth": "Skipped: not an OAuth request",
    "already-shaped": "Skipped: billing block already present",
    "no-user-text": "Skipped: no first-user text",
};

function parseVersionError(value: unknown): VersionError | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "object") {
        throw new Error("Invalid version error");
    }
    const requiredVersion: unknown = Reflect.get(value, "requiredVersion");
    const hint: unknown = Reflect.get(value, "hint");
    const at: unknown = Reflect.get(value, "at");
    if (
        (requiredVersion !== null && typeof requiredVersion !== "string") ||
        typeof hint !== "string" ||
        typeof at !== "number" ||
        !Number.isFinite(at)
    ) {
        throw new Error("Invalid version error");
    }
    return { requiredVersion, hint, at };
}

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
        const versionError = parseVersionError(Reflect.get(value, "versionError"));
        const learnedFloor: unknown = Reflect.get(value, "learnedFloor") ?? null;
        const lastRetry: unknown = Reflect.get(value, "lastRetry") ?? "none";
        if (learnedFloor !== null && typeof learnedFloor !== "string") {
            throw new Error("Invalid learned floor");
        }
        if (lastRetry !== "none" && lastRetry !== "recovered" && lastRetry !== "failed") {
            throw new Error("Invalid retry status");
        }
        const transportVersion: unknown = Reflect.get(value, "transportVersion") ?? null;
        if (transportVersion !== null && typeof transportVersion !== "string") {
            throw new Error("Invalid transport version");
        }
        if (
            typeof version !== "string" ||
            (source !== "default" &&
                source !== "environment" &&
                source !== "transport" &&
                source !== "server-required")
        ) {
            throw new Error("Invalid diagnostics version");
        }
        if (last === null) {
            return {
                version,
                source,
                learnedFloor,
                lastRetry,
                transportVersion,
                versionError,
                last,
            };
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
        return {
            version,
            source,
            transportVersion,
            learnedFloor,
            lastRetry,
            versionError,
            last: { outcome: checked, provider, at },
        };
    },
);
