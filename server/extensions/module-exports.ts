/** Reading what an extension's `server.ts` exports: each reader narrows an `unknown` and throws with the reason. */

import type { Extension } from "@earendil-works/pi-durable";

import { isRecord } from "../../shared/guards.ts";
import type { Action, ExtensionMeta } from "./contract.ts";

/** The `actions` export as a map, nothing when absent. Throws when it is not an object of functions. */
export function actionsOf(value: unknown): ReadonlyMap<string, Action> | undefined {
    if (value === undefined) {
        return undefined;
    }

    const proto: unknown =
        typeof value === "object" && value !== null ? Reflect.getPrototypeOf(value) : 0;

    if (proto !== Object.prototype && proto !== null) {
        throw new Error("the `actions` export must be a plain object of functions");
    }

    const actions = new Map<string, Action>();

    for (const [name, action] of Object.entries(value ?? {})) {
        if (typeof action !== "function") {
            throw new Error(`the action "${name}" is not a function`);
        }

        actions.set(name, (call) => action(call));
    }

    return actions;
}

/** The `meta` export, or the folder's name with no description when absent. Throws when it is bad. */
export function metaOf(folder: string, value: unknown): ExtensionMeta {
    if (value === undefined) {
        return { title: folder, description: "" };
    }

    const title: unknown = isRecord(value) ? Reflect.get(value, "title") : undefined;
    const description: unknown = isRecord(value) ? Reflect.get(value, "description") : undefined;
    const toggle: unknown = isRecord(value) ? Reflect.get(value, "toggle") : undefined;

    if (
        typeof title !== "string" ||
        title === "" ||
        typeof description !== "string" ||
        description === "" ||
        (toggle !== undefined && typeof toggle !== "boolean")
    ) {
        throw new Error(
            "the `meta` export must be { title, description, toggle? }: non-empty strings and a boolean",
        );
    }

    return { title, description, ...(toggle === true ? { toggle } : {}) };
}

export function isExtension(value: unknown): value is Extension {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const name: unknown = Reflect.get(value, "name");

    return typeof name === "string" && name !== "";
}
