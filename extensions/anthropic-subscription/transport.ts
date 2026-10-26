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
                const version = configured.override
                    ? configured.version
                    : higherVersion(configured.version, transportVersion);
                state.version = version;
                state.source = configured.override
                    ? "environment"
                    : version === configured.version
                      ? "default"
                      : "transport";
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
                const response = await (shaped === undefined
                    ? next(input, init)
                    : next(withPayload(request, shaped)));
                const rejection = await readVersionRejection(response);
                return rejection === undefined
                    ? response
                    : hintedResponse(
                          response,
                          rejection,
                          recoveryHint(rejection.requiredVersion, configured.override, version),
                          state,
                      );
            }
        }
        state.last = { outcome, provider: model.provider, at: Date.now() };
        return next(input, init);
    };
}
