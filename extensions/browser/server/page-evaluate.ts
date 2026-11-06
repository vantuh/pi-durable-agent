import { BrowserError, type Json } from "./cdp.ts";
import { DESCRIBE_FUNCTION } from "./page-scripts.ts";
import type { Send } from "./send.ts";

/** A page script's result, or its exception as an error. */
export function evaluated(response: Json): Json {
    if (response.exceptionDetails !== undefined) {
        const details = response.exceptionDetails;
        const message =
            details.exception?.description ??
            details.exception?.value ??
            details.text ??
            "The script failed";

        throw new BrowserError(String(message).split("\n    at ")[0] ?? "The script failed");
    }

    return response.result?.value;
}

/** Run JavaScript in the page: an expression or statements (top-level await works), or a body that uses `return`. */
export async function evaluateScript(
    send: Send,
    script: string,
    options: { timeoutMs?: number } = {},
): Promise<string> {
    const run = (expression: string, replMode: boolean) =>
        send(
            "Runtime.evaluate",
            {
                expression,
                replMode,
                awaitPromise: true,
                userGesture: true,
                objectGroup: "pi-pocket",
                generatePreview: false,
                timeout: options.timeoutMs ?? 30_000,
            },
            (options.timeoutMs ?? 30_000) + 5000,
        );
    // REPL mode, as in DevTools' console: top-level await works and names can be declared again. A body that returns
    // its result is not a script there; it runs as a function, outside REPL mode, which would not await its promise.
    let response = await run(script, true);

    if (
        /Illegal return statement/.test(
            String(response.exceptionDetails?.exception?.description ?? ""),
        )
    ) {
        response = await run(`(async () => {\n${script}\n})()`, false);
    }

    try {
        if (response.exceptionDetails !== undefined) {
            evaluated(response);
        }

        const result = response.result ?? {};

        if (result.type === "undefined") {
            return "undefined";
        }

        if (result.objectId === undefined) {
            if (result.unserializableValue !== undefined) {
                return String(result.unserializableValue);
            }

            return typeof result.value === "string" ? result.value : JSON.stringify(result.value);
        }

        const described = await send("Runtime.callFunctionOn", {
            objectId: result.objectId,
            functionDeclaration: DESCRIBE_FUNCTION,
            returnByValue: true,
        });

        return String(described.result?.value ?? result.description ?? "");
    } finally {
        void send("Runtime.releaseObjectGroup", { objectGroup: "pi-pocket" }).catch(() => {});
    }
}
