/**
 * The browser half of extensions: every `extensions/<folder>/web.tsx` contributes status-bar items,
 * composer controls, blocks above the composer and under the session list, status popover markers, settings sections, side panels, tool icons and session menu items.
 * The core names no folder; the folder is the one in the path. Modules load lazily, so one that
 * throws or fails to import is skipped and the app still renders. A folder the server turned off
 * is not imported, and its items go away when it is turned off.
 */

import { useEffect, useState } from "react";

import { listExtensions } from "./lib/api.ts";
import type {
    AboveComposerItem,
    ComposerItem,
    HeaderItem,
    PanelItem,
    SessionMenuItem,
    SettingsSection,
    SidebarBottomItem,
    StatusItem,
    StatusRowItem,
    ToolIcon,
} from "./sdk/types.ts";

export type FolderStatusItem = StatusItem & { folder: string };
export type FolderSettingsSection = SettingsSection & { folder: string };
export type FolderPanel = PanelItem & { folder: string };

export type FolderHeaderItem = HeaderItem & { folder: string };
export type FolderComposerItem = ComposerItem & { folder: string };
export type FolderAboveComposerItem = AboveComposerItem & { folder: string };
export type FolderSidebarBottomItem = SidebarBottomItem & { folder: string };
export type FolderStatusRowItem = StatusRowItem & { folder: string };
export type FolderToolIcon = ToolIcon & { folder: string };
export type FolderSessionMenuItem = SessionMenuItem & { folder: string };

const SLOTS = new Set(["start", "center", "end", "composer", "title"]);

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

function isHeaderItem(value: unknown): value is HeaderItem {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "id") === "string" &&
        typeof Reflect.get(value, "component") === "function"
    );
}

function isComposerItem(value: unknown): value is ComposerItem {
    return isHeaderItem(value);
}

function isAboveComposerItem(value: unknown): value is AboveComposerItem {
    return isHeaderItem(value);
}

function isSidebarBottomItem(value: unknown): value is SidebarBottomItem {
    return isHeaderItem(value);
}

function isStatusRowItem(value: unknown): value is StatusRowItem {
    return isHeaderItem(value) && typeof Reflect.get(value, "has") === "function";
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

function isPanel(value: unknown): value is PanelItem {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "id") === "string" &&
        typeof Reflect.get(value, "title") === "string" &&
        Reflect.get(value, "icon") !== undefined &&
        typeof Reflect.get(value, "component") === "function"
    );
}

/** An icon component; lucide's are `forwardRef` objects, not functions. */
function isToolIcon(value: unknown): value is ToolIcon {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const icon: unknown = Reflect.get(value, "icon");

    return (
        typeof Reflect.get(value, "id") === "string" &&
        (typeof icon === "function" || (typeof icon === "object" && icon !== null))
    );
}

function isSessionMenuItem(value: unknown): value is SessionMenuItem {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const label: unknown = Reflect.get(value, "label");

    return (
        typeof Reflect.get(value, "id") === "string" &&
        (typeof label === "string" || typeof label === "function") &&
        typeof Reflect.get(value, "run") === "function"
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

type Loaded = {
    status: FolderStatusItem[];
    header: FolderHeaderItem[];
    composer: FolderComposerItem[];
    aboveComposer: FolderAboveComposerItem[];
    sidebarBottom: FolderSidebarBottomItem[];
    statusRow: FolderStatusRowItem[];
    settings: FolderSettingsSection[];
    panels: FolderPanel[];
    tools: FolderToolIcon[];
    sessionMenu: FolderSessionMenuItem[];
};

const folders = Object.entries(import.meta.glob("../../extensions/*/web.tsx"))
    .map(([path, importModule]) => ({
        folder: path.split("/").slice(-2)[0] ?? path,
        importModule,
    }))
    .filter(({ folder }) => !folder.startsWith("_") && !folder.startsWith("."));

/** Folders the server says are off. A folder it does not list (web only) is on. */
let disabled: ReadonlySet<string> = new Set();
/** False until one answer came: before that nothing is imported, as the browser cannot know what is off. */
let known = false;
const RETRY_MS = 2000;
let retry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const modules = new Map<string, Promise<Loaded>>();

async function loadFolder(folder: string, importModule: () => Promise<unknown>): Promise<Loaded> {
    const loaded: Loaded = {
        status: [],
        header: [],
        composer: [],
        aboveComposer: [],
        sidebarBottom: [],
        statusRow: [],
        settings: [],
        panels: [],
        tools: [],
        sessionMenu: [],
    };

    try {
        const module = await importModule();

        collect(folder, "header", module, isHeaderItem, loaded.header);
        collect(folder, "composer", module, isComposerItem, loaded.composer);
        collect(folder, "aboveComposer", module, isAboveComposerItem, loaded.aboveComposer);
        collect(folder, "sidebarBottom", module, isSidebarBottomItem, loaded.sidebarBottom);
        collect(folder, "statusRow", module, isStatusRowItem, loaded.statusRow);
        collect(folder, "status", module, isStatusItem, loaded.status);
        collect(folder, "settings", module, isSection, loaded.settings);
        collect(folder, "panels", module, isPanel, loaded.panels);
        collect(folder, "tools", module, isToolIcon, loaded.tools);
        collect(folder, "sessionMenu", module, isSessionMenuItem, loaded.sessionMenu);
    } catch (error) {
        console.error(`extension ${folder}: web.tsx skipped:`, error);
    }

    return loaded;
}

/** Reads which folders are on, then tells every hook. Call it after a folder was turned on or off. */
export async function refreshExtensions(): Promise<void> {
    try {
        disabled = new Set(
            (await listExtensions()).filter((info) => !info.enabled).map((info) => info.name),
        );
        known = true;
    } catch (error) {
        console.error("extensions: could not read which are on:", error);

        if (!known && retry === undefined) {
            retry = setTimeout(() => {
                retry = undefined;
                void refreshExtensions();
            }, RETRY_MS);
        }
    }

    for (const listener of listeners) {
        listener();
    }
}

const first = refreshExtensions();

const pickStatus = (loaded: Loaded): FolderStatusItem[] => loaded.status;
const pickSettings = (loaded: Loaded): FolderSettingsSection[] => loaded.settings;
const pickPanels = (loaded: Loaded): FolderPanel[] => loaded.panels;

function useLoaded<T>(pick: (loaded: Loaded) => T[]): readonly T[] {
    const [items, setItems] = useState<readonly T[]>([]);

    useEffect(() => {
        let alive = true;
        let latest = 0;

        const update = async (): Promise<void> => {
            latest += 1;

            const mine = latest;

            await first;

            // Only a folder that is on is imported, and only once.
            const wanted = known ? folders.filter(({ folder }) => !disabled.has(folder)) : [];
            const found = await Promise.all(
                wanted.map(({ folder, importModule }) => {
                    const cached = modules.get(folder) ?? loadFolder(folder, importModule);

                    modules.set(folder, cached);

                    return cached;
                }),
            );

            if (alive && mine === latest) {
                setItems(found.flatMap(pick));
            }
        };
        const listener = (): void => {
            void update();
        };

        listener();
        listeners.add(listener);

        return () => {
            alive = false;
            listeners.delete(listener);
        };
    }, [pick]);

    return items;
}

/** The status items of every folder that is on and loaded; empty until the modules are in. */
export function useStatusItems(): readonly FolderStatusItem[] {
    return useLoaded(pickStatus);
}

/** The settings sections of every folder that is on and loaded; empty until the modules are in. */
export function useSettingsSections(): readonly FolderSettingsSection[] {
    return useLoaded(pickSettings);
}

/** The side panels of every folder that is on and loaded; empty until the modules are in. */
export function usePanels(): readonly FolderPanel[] {
    return useLoaded(pickPanels);
}

const pickHeader = (loaded: Loaded): FolderHeaderItem[] => loaded.header;

/** Arbitrary extension controls in the conversation header. */
export function useHeaderItems(): readonly FolderHeaderItem[] {
    return useLoaded(pickHeader);
}

const pickComposer = (loaded: Loaded): FolderComposerItem[] => loaded.composer;

/** Controls extensions add to the composer's row, beside Send. */
export function useComposerItems(): readonly FolderComposerItem[] {
    return useLoaded(pickComposer);
}

const pickAboveComposer = (loaded: Loaded): FolderAboveComposerItem[] => loaded.aboveComposer;

/** Blocks extensions put above the composer; empty until the modules are in. */
export function useAboveComposerItems(): readonly FolderAboveComposerItem[] {
    return useLoaded(pickAboveComposer);
}

const pickSidebarBottom = (loaded: Loaded): FolderSidebarBottomItem[] => loaded.sidebarBottom;

/** Blocks extensions put under the sidebar's session list; empty until the modules are in. */
export function useSidebarBottomItems(): readonly FolderSidebarBottomItem[] {
    return useLoaded(pickSidebarBottom);
}

const pickStatusRow = (loaded: Loaded): FolderStatusRowItem[] => loaded.statusRow;

/** The markers extensions add to rows of the status popover; empty until the modules are in. */
export function useStatusRowItems(): readonly FolderStatusRowItem[] {
    return useLoaded(pickStatusRow);
}

const pickTools = (loaded: Loaded): FolderToolIcon[] => loaded.tools;

/** The icons extensions give their tools; empty until the modules are in. */
export function useToolIcons(): readonly FolderToolIcon[] {
    return useLoaded(pickTools);
}

const pickSessionMenu = (loaded: Loaded): FolderSessionMenuItem[] => loaded.sessionMenu;

/** The items extensions add to every session row's menu; empty until the modules are in. */
export function useSessionMenu(): readonly FolderSessionMenuItem[] {
    return useLoaded(pickSessionMenu);
}
