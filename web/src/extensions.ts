/**
 * The browser half of extensions: every `extensions/<folder>/web.tsx` contributes status-bar items.
 * The core names no folder; the folder is the one in the path. Modules load lazily, so one that
 * throws or fails to import is skipped and the app still renders.
 */

import { useEffect, useState } from "react";

import type { StatusItem } from "./sdk/types.ts";

export type FolderStatusItem = StatusItem & { folder: string };

const SLOTS = new Set(["start", "center", "end"]);

function isStatusItem(value: unknown): value is StatusItem {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const id: unknown = Reflect.get(value, "id");
    const slot: unknown = Reflect.get(value, "slot");

    return (
        typeof id === "string" &&
        typeof slot === "string" &&
        SLOTS.has(slot) &&
        typeof Reflect.get(value, "component") === "function"
    );
}

function statusOf(module: unknown): StatusItem[] {
    const extension: unknown =
        typeof module === "object" && module !== null ? Reflect.get(module, "default") : undefined;

    if (typeof extension !== "object" || extension === null) {
        throw new Error("the default export must be an object");
    }

    const status: unknown = Reflect.get(extension, "status");

    if (status === undefined) {
        return [];
    }

    if (!Array.isArray(status) || !status.every(isStatusItem)) {
        throw new Error(
            "`status` must be a list of { id, slot, component } with function components",
        );
    }

    return status;
}

async function load(): Promise<FolderStatusItem[]> {
    const modules = import.meta.glob("../../extensions/*/web.tsx");
    const entries = Object.entries(modules)
        .map(([path, importModule]) => ({
            folder: path.split("/").slice(-2)[0] ?? path,
            importModule,
        }))
        .filter(({ folder }) => !folder.startsWith("_") && !folder.startsWith("."));
    const settled = await Promise.allSettled(entries.map(({ importModule }) => importModule()));
    const items: FolderStatusItem[] = [];

    settled.forEach((result, index) => {
        const folder = entries[index]?.folder ?? "";

        if (result.status === "rejected") {
            console.error(`extension ${folder}: web.tsx skipped:`, result.reason);

            return;
        }

        try {
            const ids = new Set<string>();

            for (const item of statusOf(result.value)) {
                if (ids.has(item.id)) {
                    console.error(
                        `extension ${folder}: status item "${item.id}" skipped: duplicate id`,
                    );

                    continue;
                }

                ids.add(item.id);
                items.push({ ...item, folder });
            }
        } catch (error) {
            console.error(`extension ${folder}: web.tsx skipped:`, error);
        }
    });

    return items;
}

const loaded: Promise<FolderStatusItem[]> = load();

/** The status items of every folder that loaded; empty until the modules are in. */
export function useStatusItems(): readonly FolderStatusItem[] {
    const [items, setItems] = useState<readonly FolderStatusItem[]>([]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const found = await loaded;

            if (alive) {
                setItems(found);
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    return items;
}
