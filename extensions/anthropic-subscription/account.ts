/**
 * Adapted from pi-anthropic-auth's account-profile lookup.
 * Copyright (c) 2026 Christopher D. Lasher. MIT; see LICENSE.pi-anthropic-auth.
 */
import type { ModelFetch, ResolveModelAuth } from "../../server/model-requests.ts";
import type { AccountResult } from "./account-refs.ts";
import { record } from "./transport.ts";

function text(source: Record<string, unknown>, key: string): string | null {
    return typeof source[key] === "string" ? source[key] : null;
}

/** On-demand only. Resolve current auth each time; never cache credentials or raw profile data. */
export async function lookupAccount(
    resolveAuth: ResolveModelAuth,
    includeIdentity: boolean,
    fetch: ModelFetch = globalThis.fetch,
    signal: AbortSignal = AbortSignal.timeout(5000),
): Promise<AccountResult> {
    try {
        const auth = await resolveAuth("anthropic", signal);
        signal.throwIfAborted();
        const headers = new Headers();
        for (const [key, value] of Object.entries(auth?.headers ?? {})) {
            if (value !== null) {
                headers.set(key, value);
            }
        }
        const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const token = auth?.apiKey?.startsWith("sk-ant-oat") ? auth.apiKey : bearer;
        if (token === undefined || !/^sk-ant-oat[^\s]*$/.test(token)) {
            return { kind: "not-oauth" };
        }
        const response = await fetch("https://api.anthropic.com/api/oauth/profile", {
            headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
            signal,
            redirect: "error",
        });
        if (!response.ok) {
            await response.body?.cancel();
            return { kind: "unavailable", reason: `HTTP ${response.status}` };
        }
        const body: unknown = await response.json();
        if (!record(body) || !record(body["organization"])) {
            return { kind: "unavailable", reason: "Unexpected profile response" };
        }
        const organization = body["organization"];
        const identity = record(body["account"]) ? body["account"] : {};
        return {
            kind: "profile",
            checkedAt: Date.now(),
            profile: {
                organizationType: text(organization, "organization_type"),
                subscriptionStatus: text(organization, "subscription_status"),
                rateLimitTier: text(organization, "rate_limit_tier"),
                seatTier: text(organization, "seat_tier"),
                extraUsageEnabled:
                    typeof organization["has_extra_usage_enabled"] === "boolean"
                        ? organization["has_extra_usage_enabled"]
                        : null,
                email: includeIdentity ? text(identity, "email") : null,
                organizationName: includeIdentity ? text(organization, "name") : null,
            },
        };
    } catch {
        // Raw auth/fetch errors may contain secrets, URLs or account identifiers.
        return {
            kind: "unavailable",
            reason: signal.aborted
                ? "Account lookup timed out or was cancelled"
                : "Account lookup failed",
        };
    }
}
