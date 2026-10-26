import type { ClientUsage } from "../../../shared/protocol.ts";

export type Health = {
    model: string;
    busy: boolean;
    cwd: string;
    branch: string | null;
    title: string | null;
    usage: ClientUsage;
};

function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

function str(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function number(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usage(value: unknown): ClientUsage {
    const sum = record(value);

    return {
        input: number(sum?.["input"]),
        output: number(sum?.["output"]),
        cost: number(sum?.["cost"]),
    };
}

/** `undefined` when the server is not up: the page must open over a stopped server too. */
export async function getHealth(): Promise<Health | undefined> {
    try {
        const response = await fetch("/api/health");

        if (!response.ok) {
            return undefined;
        }

        const body = record(await response.json());

        if (body === undefined) {
            return undefined;
        }

        const branch = body["branch"];
        const title = body["title"];

        return {
            model: str(body["model"], ""),
            busy: body["busy"] === true,
            cwd: str(body["cwd"], ""),
            branch: typeof branch === "string" ? branch : null,
            title: typeof title === "string" ? title : null,
            usage: usage(body["usage"]),
        };
    } catch {
        return undefined;
    }
}

export async function sendMessage(body: string): Promise<boolean> {
    const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body }),
    });

    return response.ok;
}

export async function stopRun(): Promise<void> {
    await fetch("/api/abort", { method: "POST" });
}
