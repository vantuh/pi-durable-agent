import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

export const DEFAULT_VERSION = "2.1.280";
/** The system block this extension adds; what marks a request as already shaped. */
export const MARKER = "x-anthropic-billing-header:";

export type ShapeOutcome = "applied" | "not-oauth" | "already-shaped" | "no-user-text";
export type VersionError = { requiredVersion: string | null; hint: string; at: number };
export type Diagnostics = {
    version: string;
    sentVersion: string | null;
    source: "default" | "environment" | "transport" | "server-required";
    learnedFloor: string | null;
    lastRetry: "none" | "recovered" | "failed";
    transportVersion: string | null;
    versionError: VersionError | null;
    last: { outcome: ShapeOutcome; provider: string; at: number } | null;
};

export const outcomes: Record<ShapeOutcome, string> = {
    applied: "Shaping applied",
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
        const sentVersion: unknown = Reflect.get(value, "sentVersion") ?? null;
        if (sentVersion !== null && typeof sentVersion !== "string") {
            throw new Error("Invalid sent version");
        }
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
                sentVersion,
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
            sentVersion,
            source,
            transportVersion,
            learnedFloor,
            lastRetry,
            versionError,
            last: { outcome: checked, provider, at },
        };
    },
);

export type AccountProfile = {
    organizationType: string | null;
    subscriptionStatus: string | null;
    rateLimitTier: string | null;
    seatTier: string | null;
    extraUsageEnabled: boolean | null;
    email: string | null;
    organizationName: string | null;
};
export type AccountResult =
    | { kind: "not-oauth" }
    | { kind: "unavailable"; reason: string }
    | { kind: "profile"; checkedAt: number; profile: AccountProfile };

function nullableText(value: unknown): string | null {
    if (value === null || typeof value === "string") {
        return value;
    }
    throw new Error("Invalid profile field");
}

export const account = actionRef<{ includeIdentity: boolean }, AccountResult>(
    "anthropic-subscription",
    "account",
    (value) => {
        if (!isRecord(value)) {
            throw new Error("Invalid account result");
        }
        if (value["kind"] === "not-oauth") {
            return { kind: "not-oauth" };
        }
        if (value["kind"] === "unavailable" && typeof value["reason"] === "string") {
            return { kind: "unavailable", reason: value["reason"] };
        }
        const profile = value["profile"];
        const checkedAt = value["checkedAt"];
        if (
            value["kind"] !== "profile" ||
            !isRecord(profile) ||
            typeof checkedAt !== "number" ||
            !Number.isFinite(checkedAt)
        ) {
            throw new Error("Invalid account profile");
        }
        const extraUsageEnabled = profile["extraUsageEnabled"];
        if (extraUsageEnabled !== null && typeof extraUsageEnabled !== "boolean") {
            throw new Error("Invalid extra usage status");
        }
        return {
            kind: "profile",
            checkedAt,
            profile: {
                organizationType: nullableText(profile["organizationType"]),
                subscriptionStatus: nullableText(profile["subscriptionStatus"]),
                rateLimitTier: nullableText(profile["rateLimitTier"]),
                seatTier: nullableText(profile["seatTier"]),
                extraUsageEnabled,
                email: nullableText(profile["email"]),
                organizationName: nullableText(profile["organizationName"]),
            },
        };
    },
);
