import { actionRef } from "../../shared/extension-api.ts";

export type Part = { name: string; preview: string; tokens: number };

export type Breakdown = {
    model: string;
    used: number;
    window: number;
    sections: Part[];
    tools: Part[];
};

function isPart(value: unknown): value is Part {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "name") === "string" &&
        typeof Reflect.get(value, "preview") === "string" &&
        typeof Reflect.get(value, "tokens") === "number"
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
        Array.isArray(sections) &&
        sections.every(isPart) &&
        Array.isArray(tools) &&
        tools.every(isPart)
    );
}

/** What the conversation's context holds: the system prompt sections and tools, and how full it is. Null until there is an answer. */
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
