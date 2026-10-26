import type { ActionRef } from "../../../shared/extension-api.ts";

function messageOf(body: unknown, fallback: string): string {
    const error: unknown =
        typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;

    return typeof error === "string" ? error : fallback;
}

/** Calls an action of an extension's server half. The ref's `parse` checks the result; if it throws, so does the call. */
export async function callAction<Args, Result>(
    ref: ActionRef<Args, Result>,
    args: Args,
    session: number | null,
): Promise<Result> {
    const path = `/api/extensions/${encodeURIComponent(ref.extension)}/actions/${encodeURIComponent(ref.name)}`;
    const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(session === null ? {} : { session }), args }),
    });
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
        throw new Error(messageOf(body, `${path}: ${String(response.status)}`));
    }

    const result: unknown =
        typeof body === "object" && body !== null ? Reflect.get(body, "result") : undefined;

    return ref.parse(result);
}
