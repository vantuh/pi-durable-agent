import { actionRef } from "../../shared/extension-api.ts";

/** One row of the breakdown; `parts` holds the tools an extension put in the prompt, when it put two or more. */
export type Part = { name: string; preview: string; tokens: number; parts?: Part[] };

export type Breakdown = {
    model: string;
    used: number;
    window: number;
    /** Sizes are scaled to the model's own count of the first request; otherwise raw estimates. */
    calibrated: boolean;
    /**
     * Nothing has been sent yet: the rows are the system prompt and tools the first request will carry,
     * estimated from their text, and `used` is their sum rather than a count the model gave.
     */
    estimate: boolean;
    sections: Part[];
    tools: Part[];
};

function isPart(value: unknown): value is Part {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const parts: unknown = Reflect.get(value, "parts");

    return (
        typeof Reflect.get(value, "name") === "string" &&
        typeof Reflect.get(value, "preview") === "string" &&
        typeof Reflect.get(value, "tokens") === "number" &&
        (parts === undefined || (Array.isArray(parts) && parts.every(isPart)))
    );
}

function isBreakdown(value: unknown): value is Breakdown {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const sections: unknown = Reflect.get(value, "sections");
    const tools: unknown = Reflect.get(value, "tools");

    return (
        typeof Reflect.get(value, "model") === "string" &&
        typeof Reflect.get(value, "used") === "number" &&
        typeof Reflect.get(value, "window") === "number" &&
        typeof Reflect.get(value, "calibrated") === "boolean" &&
        typeof Reflect.get(value, "estimate") === "boolean" &&
        Array.isArray(sections) &&
        sections.every(isPart) &&
        Array.isArray(tools) &&
        tools.every(isPart)
    );
}

/**
 * What the conversation's context holds: the system prompt sections and tools, and how full it is. Null
 * for a session with no answer yet that has anything in it, or one the server cannot name a model for.
 */
export const breakdown = actionRef<undefined, Breakdown | null>(
    "context-meter",
    "breakdown",
    (value) => {
        if (value === null || isBreakdown(value)) {
            return value;
        }

        throw new Error("the breakdown is malformed");
    },
);
