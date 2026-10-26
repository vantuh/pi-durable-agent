/**
 * Adapted from pi-anthropic-auth's version-rejection and billing-version-sync.
 * Copyright (c) 2026 Christopher D. Lasher. MIT; see LICENSE.pi-anthropic-auth.
 */
import type { Diagnostics } from "./refs.ts";
import { higherVersion } from "./version.ts";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type VersionRejection = {
    requiredVersion: string | null;
    body: Record<string, unknown>;
    error: Record<string, unknown>;
};

export async function readVersionRejection(
    response: Response,
): Promise<VersionRejection | undefined> {
    if (response.status !== 400) {
        return undefined;
    }
    try {
        const body: unknown = await response.clone().json();
        const error = record(body) ? body["error"] : undefined;
        const details = record(error) ? error["details"] : undefined;
        if (
            !record(body) ||
            !record(error) ||
            !record(details) ||
            details["error_code"] !== "claude_code_version_too_old"
        ) {
            return undefined;
        }
        const message = typeof error["message"] === "string" ? error["message"] : "";
        return {
            body,
            error,
            requiredVersion:
                /version (\d+\.\d+\.\d+) or newer is required/.exec(message)?.[1] ?? null,
        };
    } catch {
        return undefined;
    }
}

export function recoveryHint(
    required: string | null,
    override: boolean,
    sentVersion: string | null,
): string {
    const target = required ?? "the current Claude Code release";
    if (
        required !== null &&
        sentVersion !== null &&
        higherVersion(sentVersion, required) === sentVersion
    ) {
        return `The billing block already reports ${sentVersion}, meeting the required ${required}. This rejection may come from Pi's own Claude CLI version. Update Pi; changing the billing version to the same value will not help.`;
    }
    if (override) {
        return `The billing-version override is explicit and disables automatic recovery. Set PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION to ${target} or unset it to use automatic version selection.`;
    }
    return `Automatic version recovery did not succeed. Set PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION to ${target} and retry. If Pi's own Claude CLI version is too old, update Pi.`;
}

export async function hintedResponse(
    response: Response,
    rejection: VersionRejection,
    hint: string,
    state: Pick<Diagnostics, "versionError">,
): Promise<Response> {
    state.versionError = { requiredVersion: rejection.requiredVersion, hint, at: Date.now() };
    const message =
        typeof rejection.error["message"] === "string" ? rejection.error["message"] : "";
    const body = JSON.stringify({
        ...rejection.body,
        error: {
            ...rejection.error,
            message: `${message} [anthropic-subscription] ${hint}`.trim(),
        },
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    await response.body?.cancel();
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
