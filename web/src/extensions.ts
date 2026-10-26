/**
 * The browser half of extensions: every `extensions/<folder>/web.tsx` contributes status-bar items
 * and settings sections.
 * The core names no folder; the folder is the one in the path. Modules load lazily, so one that
 * throws or fails to import is skipped and the app still renders.
 */

import { useEffect, useState } from "react";

import type { SettingsSection, StatusItem } from "./sdk/types.ts";

export type FolderStatusItem = StatusItem & { folder: string };
export type FolderSettingsSection = SettingsSection & { folder: string };

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

function isSection(value: unknown): value is SettingsSection {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "id") === "string" &&
        typeof Reflect.get(value, "title") === "string" &&
        typeof Reflect.get(value, "component") === "function"
    );
}

/** One list of a module's default export; absent is empty, a bad list throws. */
function listOf<T>(module: unknown, key: string, check: (value: unknown) => value is T): T[] {
    const extension: unknown =
        typeof module === "object" && module !== null ? Reflect.get(module, "default") : undefined;

    if (typeof extension !== "object" || extension === null) {
        throw new Error("the default export must be an object");
    }

    const list: unknown = Reflect.get(extension, key);

    if (list === undefined) {
        return [];
    }

    if (!Array.isArray(list) || !list.every(check)) {
        throw new Error(
            `\`${key}\` is not a list of the right shape (components must be functions)`,
        );
    }

    return list;
}

/** Adds the folder's items; a bad list or a repeated id is skipped and logged by folder. */
function collect<T extends { id: string }>(
    folder: string,
    key: string,
    module: unknown,
    check: (value: unknown) => value is T,
    into: (T & { folder: string })[],
): void {
    try {
        const ids = new Set<string>();

        for (const item of listOf(module, key, check)) {
            if (ids.has(item.id)) {
                console.error(
                    `extension ${folder}: ${key} item "${item.id}" skipped: duplicate id`,
                );

                continue;
            }

            ids.add(item.id);
            into.push({ ...item, folder });
        }
    } catch (error) {
        console.error(`extension ${folder}: ${key} skipped:`, error);
    }
}

type Loaded = { status: FolderStatusItem[]; settings: FolderSettingsSection[] };

async function load(): Promise<Loaded> {
    const modules = import.meta.glob("../../extensions/*/web.tsx");
    const entries = Object.entries(modules)
        .map(([path, importModule]) => ({
            folder: path.split("/").slice(-2)[0] ?? path,
            importModule,
        }))
        .filter(({ folder }) => !folder.startsWith("_") && !folder.startsWith("."));
    const settled = await Promise.allSettled(entries.map(({ importModule }) => importModule()));
    const loaded: Loaded = { status: [], settings: [] };

    settled.forEach((result, index) => {
        const folder = entries[index]?.folder ?? "";

        if (result.status === "rejected") {
            console.error(`extension ${folder}: web.tsx skipped:`, result.reason);

            return;
        }

        collect(folder, "status", result.value, isStatusItem, loaded.status);
        collect(folder, "settings", result.value, isSection, loaded.settings);
    });

    return loaded;
}

const loaded: Promise<Loaded> = load();

function useLoaded<K extends keyof Loaded>(key: K): readonly Loaded[K][number][] {
    const [items, setItems] = useState<readonly Loaded[K][number][]>([]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const found = await loaded;

            if (alive) {
                setItems(found[key]);
            }
        })();

        return () => {
            alive = false;
        };
    }, [key]);

    return items;
}

/** The status items of every folder that loaded; empty until the modules are in. */
export function useStatusItems(): readonly FolderStatusItem[] {
    return useLoaded("status");
}

/** The settings sections of every folder that loaded; empty until the modules are in. */
export function useSettingsSections(): readonly FolderSettingsSection[] {
    return useLoaded("settings");
}
