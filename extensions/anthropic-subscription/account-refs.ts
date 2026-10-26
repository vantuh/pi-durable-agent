import { actionRef } from "../../shared/extension-api.ts";

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

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
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
        if (!record(value)) {
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
            !record(profile) ||
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
