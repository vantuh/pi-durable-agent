/** Generic provider-payload seam; policy belongs to extensions, not the harness. */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type RequestModel = { readonly provider: string };
export type RequestShaper = (payload: unknown, model: RequestModel) => unknown;

type Options = Parameters<ModelRuntime["streamSimple"]>[2];
export type ModelFetch = NonNullable<NonNullable<Options>["fetch"]>;
export type FetchWrapper = (next: ModelFetch, model: RequestModel) => ModelFetch;

export function shapeModelRequests(
    models: ModelRuntime,
    shapers: () => readonly RequestShaper[],
    wrappers: () => readonly FetchWrapper[] = () => [],
): ModelRuntime {
    function optionsWithShapes(model: RequestModel, options: Options): Options {
        // Capture the installed version for the lifetime of this request.
        const active = shapers();
        const transport = wrappers().reduce(
            (next, wrap) => wrap(next, model),
            options?.fetch ?? globalThis.fetch,
        );
        return {
            ...options,
            fetch: transport,
            onPayload: async (payload, payloadModel) => {
                let shaped = (await options?.onPayload?.(payload, payloadModel)) ?? payload;
                for (const shape of active) {
                    shaped = shape(shaped, payloadModel) ?? shaped;
                }
                return shaped;
            },
        };
    }

    return new Proxy(models, {
        get(target, key) {
            if (key === "streamSimple") {
                return (...[model, context, options]: Parameters<ModelRuntime["streamSimple"]>) =>
                    target.streamSimple(model, context, optionsWithShapes(model, options));
            }
            if (key === "completeSimple") {
                return (...[model, context, options]: Parameters<ModelRuntime["completeSimple"]>) =>
                    target.completeSimple(model, context, optionsWithShapes(model, options));
            }
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
