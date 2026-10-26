/** Generic provider-payload seam; policy belongs to extensions, not the harness. */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type RequestModel = { readonly provider: string };
export type RequestShaper = (payload: unknown, model: RequestModel) => unknown;

type Options = Parameters<ModelRuntime["streamSimple"]>[2];

export function shapeModelRequests(
    models: ModelRuntime,
    shapers: () => readonly RequestShaper[],
): ModelRuntime {
    function optionsWithShapes(options: Options): Options {
        // Capture the installed version for the lifetime of this request.
        const active = shapers();
        return {
            ...options,
            onPayload: async (payload, model) => {
                let shaped = (await options?.onPayload?.(payload, model)) ?? payload;
                for (const shape of active) {
                    shaped = shape(shaped, model) ?? shaped;
                }
                return shaped;
            },
        };
    }

    return new Proxy(models, {
        get(target, key) {
            if (key === "streamSimple") {
                return (...[model, context, options]: Parameters<ModelRuntime["streamSimple"]>) =>
                    target.streamSimple(model, context, optionsWithShapes(options));
            }
            if (key === "completeSimple") {
                return (...[model, context, options]: Parameters<ModelRuntime["completeSimple"]>) =>
                    target.completeSimple(model, context, optionsWithShapes(options));
            }
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
