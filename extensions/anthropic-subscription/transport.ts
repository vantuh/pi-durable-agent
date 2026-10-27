import type { ModelFetch, RequestModel } from "../../server/sdk.ts";
import type { Diagnostics } from "./refs.ts";
import { hintedResponse, readVersionRejection, recoveryHint } from "./version-rejection.ts";
import { cliVersion, higherVersion } from "./version.ts";

// Ordering belongs to the installed diagnostic state, not to one model-call wrapper.
const latest = new WeakMap<Diagnostics, symbol>();

export function isOAuth(request: Request): boolean {
    return /^Bearer sk-ant-oat[^\s]*$/i.test(request.headers.get("authorization") ?? "");
}

export function requestFrom(
    input: Parameters<ModelFetch>[0],
    init: Parameters<ModelFetch>[1],
): Request {
    return new Request(input instanceof Request ? input.clone() : input, init);
}

export function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function payloadOf(request: Request): Promise<unknown> {
    try {
        return JSON.parse(await request.clone().text());
    } catch {
        return undefined;
    }
}

export function withPayload(request: Request, payload: unknown): Request {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request, { headers, body: JSON.stringify(payload) });
}

function billingBlock(payload: unknown): string | undefined {
    const system: unknown = record(payload) ? payload["system"] : undefined;
    if (!Array.isArray(system)) {
        return undefined;
    }
    for (const block of system) {
        if (
            record(block) &&
            typeof block["text"] === "string" &&
            block["text"].startsWith("x-anthropic-billing-header:")
        ) {
            return block["text"];
        }
    }
    return undefined;
}

function sentVersion(payload: unknown): string | null {
    return (
        /\bcc_version=(\d+\.\d+\.\d+)(?:\.[a-zA-Z0-9]+)?;/.exec(billingBlock(payload) ?? "")?.[1] ??
        null
    );
}

export function oauthTransport(
    next: ModelFetch,
    model: RequestModel,
    state: Diagnostics,
    shape: (payload: unknown, version: string) => unknown,
    configured: { version: string; override: boolean },
): ModelFetch {
    return async (input, init) => {
        // Other providers must neither allocate request clones nor overwrite Anthropic diagnostics.
        if (model.provider !== "anthropic") {
            return next(input, init);
        }
        const request = requestFrom(input, init);
        if (request.method !== "POST" || !/\/messages\/?$/.test(new URL(request.url).pathname)) {
            return next(input, init);
        }
        const ticket = Symbol();
        latest.set(state, ticket);
        const snapshot: Omit<Diagnostics, "learnedFloor"> = {
            version: configured.version,
            source: configured.override ? "environment" : "default",
            sentVersion: null,
            transportVersion: null,
            lastRetry: "none",
            versionError: null,
            last: { outcome: "not-oauth", provider: model.provider, at: Date.now() },
        };
        function publish(): void {
            if (latest.get(state) !== ticket) {
                return;
            }
            // The floor is shared knowledge, not a request field: older requests may still raise it.
            Object.assign(state, snapshot);
        }
        function learn(required: string | null): void {
            if (!configured.override && required !== null) {
                state.learnedFloor = higherVersion(
                    state.learnedFloor ?? configured.version,
                    required,
                );
            }
        }
        try {
            if (!isOAuth(request)) {
                return await next(input, init);
            }
            const transportVersion = cliVersion(request);
            const baseVersion = higherVersion(configured.version, transportVersion);
            const version = configured.override
                ? configured.version
                : higherVersion(baseVersion, state.learnedFloor ?? undefined);
            snapshot.version = version;
            snapshot.source = configured.override
                ? "environment"
                : version === configured.version
                  ? "default"
                  : version === baseVersion
                    ? "transport"
                    : "server-required";
            snapshot.transportVersion = transportVersion ?? null;
            const payload = await payloadOf(request);
            const shaped = shape(payload, version);
            snapshot.sentVersion = sentVersion(shaped ?? payload);
            snapshot.last = {
                outcome:
                    shaped !== undefined
                        ? "applied"
                        : billingBlock(payload) !== undefined
                          ? "already-shaped"
                          : "no-user-text",
                provider: model.provider,
                at: snapshot.last?.at ?? Date.now(),
            };
            publish();
            const replay = shaped === undefined ? undefined : withPayload(request, shaped);
            const response = await (replay === undefined
                ? next(input, init)
                : next(replay.clone()));
            const rejection = await readVersionRejection(response);
            if (rejection === undefined) {
                return response;
            }
            const required = rejection.requiredVersion;
            learn(required);
            if (
                !configured.override &&
                required !== null &&
                higherVersion(version, required) !== version &&
                replay !== undefined &&
                !request.signal.aborted
            ) {
                const retryPayload = shape(payload, required);
                if (retryPayload !== undefined) {
                    await response.body?.cancel();
                    snapshot.version = required;
                    snapshot.sentVersion = sentVersion(retryPayload);
                    snapshot.source = "server-required";
                    snapshot.lastRetry = "failed";
                    publish();
                    // Exactly one version replay; caller cancellation and transport still apply.
                    const retried = await next(withPayload(replay, retryPayload));
                    const second = await readVersionRejection(retried);
                    if (second === undefined) {
                        snapshot.lastRetry = retried.ok ? "recovered" : "failed";
                        return retried;
                    }
                    learn(second.requiredVersion);
                    return await hintedResponse(
                        retried,
                        second,
                        recoveryHint(second.requiredVersion, false, snapshot.sentVersion),
                        snapshot,
                    );
                }
            }
            return await hintedResponse(
                response,
                rejection,
                recoveryHint(required, configured.override, snapshot.sentVersion),
                snapshot,
            );
        } finally {
            // Also publish failures, but never let an older response overwrite a newer request.
            publish();
        }
    };
}
