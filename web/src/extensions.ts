/**
 * The browser half of extensions: every `extensions/<folder>/web.tsx` contributes status-bar items,
 * composer controls, blocks above the composer and under the session list, status popover markers,
 * settings sections, side panels, pages, tool icons and argument views, session menu items and
 * new-session options.
 * The core names no folder; the folder is the one in the path. Modules load lazily, so one that
 * throws or fails to import is skipped and the app still renders. A folder the server turned off
 * is not imported, and its items go away when it is turned off.
 */

import { useSyncExternalStore } from "react";

import { type ExtensionInfo, listExtensions } from "./lib/api.ts";
import type {
    AboveComposerItem,
    ComposerItem,
    HeaderItem,
    NewSessionItem,
    PageItem,
    PanelItem,
    SessionFilterItem,
    SessionMenuItem,
    SessionRowItem,
    SettingsSection,
    SidebarBottomItem,
    StatusItem,
    StatusRowItem,
    ToolIcon,
    ToolView,
} from "./sdk/types.ts";

export type FolderStatusItem = StatusItem & { folder: string };
export type FolderSettingsSection = SettingsSection & { folder: string };
export type FolderPanel = PanelItem & { folder: string };
export type FolderPage = PageItem & { folder: string };

export type FolderHeaderItem = HeaderItem & { folder: string };
export type FolderComposerItem = ComposerItem & { folder: string };
export type FolderAboveComposerItem = AboveComposerItem & { folder: string };
export type FolderSidebarBottomItem = SidebarBottomItem & { folder: string };
export type FolderStatusRowItem = StatusRowItem & { folder: string };
export type FolderToolIcon = ToolIcon & { folder: string };
export type FolderToolView = ToolView & { folder: string };
export type FolderSessionMenuItem = SessionMenuItem & { folder: string };
export type FolderSessionRowItem = SessionRowItem & { folder: string };
export type FolderSessionFilter = SessionFilterItem & { folder: string };
export type FolderNewSessionItem = NewSessionItem & { folder: string };

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
    if (!isHeaderItem(value) || typeof Reflect.get(value, "has") !== "function") {
        return false;
    }

    const submenu: unknown = Reflect.get(value, "submenu");

    return submenu === undefined || typeof submenu === "function";
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

function isPage(value: unknown): value is PageItem {
    return isPanel(value) && (Reflect.get(value, "tab") ?? false) === false;
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

function isToolView(value: unknown): value is ToolView {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "id") === "string" &&
        typeof Reflect.get(value, "args") === "function"
    );
}

function isNewSessionItem(value: unknown): value is NewSessionItem {
    if (!isHeaderItem(value) || typeof Reflect.get(value, "place") !== "function") {
        return false;
    }

    const blocked: unknown = Reflect.get(value, "blocked");
    const omit: unknown = Reflect.get(value, "omit");

    return (
        (blocked === undefined || typeof blocked === "function") &&
        (omit === undefined || typeof omit === "function")
    );
}

function isSessionMenuItem(value: unknown): value is SessionMenuItem {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const label: unknown = Reflect.get(value, "label");
    const run: unknown = Reflect.get(value, "run");
    const submenu: unknown = Reflect.get(value, "submenu");

    return (
        typeof Reflect.get(value, "id") === "string" &&
        (typeof label === "string" || typeof label === "function") &&
        // An item runs, opens a submenu, or both; one that does neither has nothing to do.
        (typeof run === "function" || typeof submenu === "function") &&
        (submenu === undefined || typeof submenu === "function")
    );
}

function isSessionRowItem(value: unknown): value is SessionRowItem {
    return isHeaderItem(value);
}

function isSessionFilterItem(value: unknown): value is SessionFilterItem {
    return isHeaderItem(value);
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
    pages: FolderPage[];
    tools: FolderToolIcon[];
    toolViews: FolderToolView[];
    sessionMenu: FolderSessionMenuItem[];
    sessionRow: FolderSessionRowItem[];
    sessionFilter: FolderSessionFilter[];
    newSession: FolderNewSessionItem[];
};

const folders = Object.entries(import.meta.glob("../../extensions/*/web.tsx"))
    .map(([path, importModule]) => ({
        folder: path.split("/").slice(-2)[0] ?? path,
        importModule,
    }))
    .filter(({ folder }) => !folder.startsWith("_") && !folder.startsWith("."));

/** Folders the server says are off. A folder it does not list (web only) is on. */
let disabled: ReadonlySet<string> = new Set();
/** What the server listed last, for the switches in Settings; replaced whole so a hook sees a new identity. */
let infos: readonly ExtensionInfo[] = [];
let toggles: readonly ExtensionInfo[] = [];
/** False until one answer came: before that nothing is imported, as the browser cannot know what is off. */
let known = false;
const listeners = new Set<() => void>();
/** Every folder's items, by folder, kept once imported: a folder turned off is skipped, not dropped. */
const modules = new Map<string, Loaded>();

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
        pages: [],
        tools: [],
        toolViews: [],
        sessionMenu: [],
        sessionRow: [],
        sessionFilter: [],
        newSession: [],
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
        collect(folder, "pages", module, isPage, loaded.pages);
        collect(folder, "tools", module, isToolIcon, loaded.tools);
        collect(folder, "toolViews", module, isToolView, loaded.toolViews);
        collect(folder, "sessionMenu", module, isSessionMenuItem, loaded.sessionMenu);
        collect(folder, "sessionRow", module, isSessionRowItem, loaded.sessionRow);
        collect(folder, "sessionFilter", module, isSessionFilterItem, loaded.sessionFilter);
        collect(folder, "newSession", module, isNewSessionItem, loaded.newSession);
    } catch (error) {
        console.error(`extension ${folder}: web.tsx skipped:`, error);
    }

    return loaded;
}

/**
 * What every extension hook reads: one frozen snapshot of the items of every folder that is on, made
 * again on each refresh, so each item keeps its identity until the folders change.
 */
type Snapshot = { readonly [Key in keyof Loaded]: readonly Loaded[Key][number][] };

function gather(loaded: readonly Loaded[]): Snapshot {
    return Object.freeze({
        status: loaded.flatMap((each) => each.status),
        header: loaded.flatMap((each) => each.header),
        composer: loaded.flatMap((each) => each.composer),
        aboveComposer: loaded.flatMap((each) => each.aboveComposer),
        sidebarBottom: loaded.flatMap((each) => each.sidebarBottom),
        statusRow: loaded.flatMap((each) => each.statusRow),
        settings: loaded.flatMap((each) => each.settings),
        panels: loaded.flatMap((each) => each.panels),
        pages: loaded.flatMap((each) => each.pages),
        tools: loaded.flatMap((each) => each.tools),
        toolViews: loaded.flatMap((each) => each.toolViews),
        sessionMenu: loaded.flatMap((each) => each.sessionMenu),
        sessionRow: loaded.flatMap((each) => each.sessionRow),
        sessionFilter: loaded.flatMap((each) => each.sessionFilter),
        newSession: loaded.flatMap((each) => each.newSession),
    });
}

/** Nothing is imported before the server has said which folders are on; empty is the answer until then. */
let snapshot = gather([]);
let loading: Promise<void> | undefined;

function publish(): void {
    toggles = infos.filter((info) => info.toggle === true);
    snapshot = gather(
        [...modules].filter(([folder]) => !disabled.has(folder)).map(([, loaded]) => loaded),
    );

    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

const RETRY_MS = 2000;
let retry: ReturnType<typeof setTimeout> | undefined;

/** Reads which folders are on, then tells every hook. Call it after a folder was turned on or off. */
export async function refreshExtensions(): Promise<void> {
    try {
        const listed = await listExtensions();

        infos = listed;
        disabled = new Set(listed.filter((info) => !info.enabled).map((info) => info.name));
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

    await loadAll();
    publish();
}

void refreshExtensions();

/** Imports every folder that is on, once each; `refreshExtensions` publishes what came in. */
async function loadAll(): Promise<void> {
    if (!known) {
        return;
    }

    while (true) {
        const missing = folders.filter(
            ({ folder }) => !disabled.has(folder) && !modules.has(folder),
        );

        if (missing.length === 0) {
            return;
        }

        // A second call while one runs waits for that pass; the loop then takes the folders a folder
        // turned on in the meantime left over.
        loading ??= Promise.all(
            missing.map(async ({ folder, importModule }) => {
                modules.set(folder, await loadFolder(folder, importModule));
            }),
        )
            .then(() => undefined)
            .finally(() => {
                loading = undefined;
            });

        await loading;
    }
}

/**
 * True once every folder that is on has been imported: before that, a key the address names may be a
 * page that is still on its way.
 */
export function useExtensionsLoaded(): boolean {
    return useSyncExternalStore(subscribe, () => known && loading === undefined);
}

/** The folders that asked for a switch in Settings (`meta.toggle`), on or off; empty until the server answered. */
export function useToggleExtensions(): readonly ExtensionInfo[] {
    return useSyncExternalStore(subscribe, () => toggles);
}

/** The status items of every folder that is on and loaded; empty until the modules are in. */
export function useStatusItems(): readonly FolderStatusItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.status);
}

/** The settings sections of every folder that is on and loaded; empty until the modules are in. */
export function useSettingsSections(): readonly FolderSettingsSection[] {
    return useSyncExternalStore(subscribe, () => snapshot.settings);
}

/** The side panels of every folder that is on and loaded; empty until the modules are in. */
export function usePanels(): readonly FolderPanel[] {
    return useSyncExternalStore(subscribe, () => snapshot.panels);
}

/** The pages of every folder that is on and loaded; empty until the modules are in. */
export function usePages(): readonly FolderPage[] {
    return useSyncExternalStore(subscribe, () => snapshot.pages);
}

/** Arbitrary extension controls in the conversation header. */
export function useHeaderItems(): readonly FolderHeaderItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.header);
}

/** Controls extensions add to the composer's row, beside Send. */
export function useComposerItems(): readonly FolderComposerItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.composer);
}

/** Blocks extensions put above the composer; empty until the modules are in. */
export function useAboveComposerItems(): readonly FolderAboveComposerItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.aboveComposer);
}

/** Blocks extensions put under the sidebar's session list; empty until the modules are in. */
export function useSidebarBottomItems(): readonly FolderSidebarBottomItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.sidebarBottom);
}

/** The markers extensions add to rows of the status popover; empty until the modules are in. */
export function useStatusRowItems(): readonly FolderStatusRowItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.statusRow);
}

/** The icons extensions give their tools; empty until the modules are in. */
export function useToolIcons(): readonly FolderToolIcon[] {
    return useSyncExternalStore(subscribe, () => snapshot.tools);
}

/** How extensions show their tools' arguments; empty until the modules are in. */
export function useToolViews(): readonly FolderToolView[] {
    return useSyncExternalStore(subscribe, () => snapshot.toolViews);
}

/** The options extensions add to the new-session folder picker; empty until the modules are in. */
export function useNewSessionItems(): readonly FolderNewSessionItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.newSession);
}

/** The items extensions add to every session row's menu; empty until the modules are in. */
export function useSessionMenu(): readonly FolderSessionMenuItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.sessionMenu);
}

/** The marks extensions draw on every session row; empty until the modules are in. */
export function useSessionRows(): readonly FolderSessionRowItem[] {
    return useSyncExternalStore(subscribe, () => snapshot.sessionRow);
}

/** The filters extensions add to the sidebar's list; empty until the modules are in. */
export function useSessionFilters(): readonly FolderSessionFilter[] {
    return useSyncExternalStore(subscribe, () => snapshot.sessionFilter);
}
