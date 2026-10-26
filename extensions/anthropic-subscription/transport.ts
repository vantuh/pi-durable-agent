import type { ModelFetch, RequestModel } from "../../server/model-requests.ts";
import type { Diagnostics } from "./refs.ts";
import { hintedResponse, readVersionRejection, recoveryHint } from "./version-rejection.ts";
import { cliVersion, higherVersion } from "./version.ts";

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

export function oauthTransport(
    next: ModelFetch,
    model: RequestModel,
    state: Diagnostics,
    shape: (payload: unknown, version: string) => unknown,
    configured: { version: string; override: boolean },
): ModelFetch {
    return async (input, init) => {
        const request = requestFrom(input, init);
        let outcome: NonNullable<Diagnostics["last"]>["outcome"] = "other-provider";
        if (model.provider === "anthropic") {
            outcome = "not-oauth";
            if (
                isOAuth(request) &&
                request.method === "POST" &&
                /\/messages\/?$/.test(new URL(request.url).pathname)
            ) {
                const transportVersion = cliVersion(request);
                const baseVersion = higherVersion(configured.version, transportVersion);
                const version = configured.override
                    ? configured.version
                    : higherVersion(baseVersion, state.learnedFloor ?? undefined);
                state.version = version;
                state.source = configured.override
                    ? "environment"
                    : version === configured.version
                      ? "default"
                      : version === baseVersion
                        ? "transport"
                        : "server-required";
                state.transportVersion = transportVersion ?? null;
                const payload = await payloadOf(request);
                const shaped = shape(payload, version);
                const system: unknown = record(payload) ? payload["system"] : undefined;
                const already =
                    Array.isArray(system) &&
                    system.some(
                        (block: unknown) =>
                            record(block) &&
                            typeof block["text"] === "string" &&
                            block["text"].startsWith("x-anthropic-billing-header:"),
                    );
                outcome =
                    shaped === undefined
                        ? already
                            ? "already-shaped"
                            : "no-user-text"
                        : "applied";
                state.last = { outcome, provider: model.provider, at: Date.now() };
                state.versionError = null;
                state.lastRetry = "none";
                const replay = shaped === undefined ? undefined : withPayload(request, shaped);
                const response = await (replay === undefined
                    ? next(input, init)
                    : next(replay.clone()));
                const rejection = await readVersionRejection(response);
                if (rejection === undefined) {
                    return response;
                }
                const required = rejection.requiredVersion;
                if (!configured.override && required !== null) {
                    state.learnedFloor = higherVersion(
                        state.learnedFloor ?? configured.version,
                        required,
                    );
                }
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
                        state.version = required;
                        state.source = "server-required";
                        state.lastRetry = "failed";
                        // Exactly one replay of a rejected request; never retry success, network errors or other HTTP errors.
                        const retried = await next(withPayload(replay, retryPayload));
                        const second = await readVersionRejection(retried);
                        if (second === undefined) {
                            state.lastRetry = retried.ok ? "recovered" : "failed";
                            return retried;
                        }
                        if (second.requiredVersion !== null) {
                            state.learnedFloor = higherVersion(
                                state.learnedFloor ?? required,
                                second.requiredVersion,
                            );
                        }
                        return hintedResponse(
                            retried,
                            second,
                            recoveryHint(second.requiredVersion, false, required),
                            state,
                        );
                    }
                }
                return hintedResponse(
                    response,
                    rejection,
                    recoveryHint(required, configured.override, version),
                    state,
                );
            }
        }
        state.last = { outcome, provider: model.provider, at: Date.now() };
        return next(input, init);
    };
}
