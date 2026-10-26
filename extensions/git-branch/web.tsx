import { GitBranch } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { SettingsProps, StatusProps, WebExtension } from "@/sdk/types.ts";

import { branch, DEFAULT_SETTINGS, setSettings, settings, type Settings } from "./refs.ts";

// The setting is shared by the status item and the settings section through this small store.
type Store = { settings: Settings; loaded: boolean };

let store: Store = { settings: DEFAULT_SETTINGS, loaded: false };
let fetching = false;
let version = 0;
const listeners = new Set<() => void>();

function publish(next: Settings): void {
    store = { settings: next, loaded: true };
    version += 1;

    for (const listener of listeners) {
        listener();
    }
}

// A failed fetch is retried by the next call; an answer older than a publish is dropped.
async function ensureLoaded(): Promise<void> {
    if (store.loaded || fetching) {
        return;
    }

    fetching = true;

    const seen = version;

    try {
        const fetched = await callAction(settings, undefined, null);

        if (version === seen) {
            publish(fetched);
        }
    } catch {
        // The defaults stay; the next call tries again.
    } finally {
        fetching = false;
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void ensureLoaded();

    return () => {
        listeners.delete(listener);
    };
}

function useStore(): Store {
    return useSyncExternalStore(subscribe, () => store);
}

function useBranch(session: StatusProps["session"]): string | null {
    const [name, setName] = useState<string | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        let alive = true;

        void ensureLoaded();
        void (async () => {
            let found: string | null = null;

            try {
                found = await callAction(branch, undefined, id);
            } catch {
                found = null;
            }

            if (alive) {
                setName(found);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new folder, or a run ending (busy going false), can change the branch
    }, [id, cwd, busy]);

    return name;
}

function Branch({ session }: StatusProps) {
    const name = useBranch(session);
    const { settings: shown, loaded } = useStore();

    if (name === null || !loaded || !shown.showInStatusBar) {
        return null;
    }

    return (
        <span className="text-faint hidden shrink-0 items-center gap-1 font-mono sm:flex">
            <GitBranch className="size-3" />
            {name}
        </span>
    );
}

function Git({ session }: SettingsProps) {
    const name = useBranch(session);
    const { showInStatusBar } = useStore().settings;
    const [error, setError] = useState<string | null>(null);
    const control = useId();

    const change = (shown: boolean): void => {
        const before = store.settings;
        const mine: Settings = { showInStatusBar: shown };

        setError(null);
        publish(mine);
        void (async () => {
            try {
                const saved = await callAction(setSettings, mine, null);

                if (store.settings === mine) {
                    publish(saved);
                }
            } catch (failure) {
                if (store.settings === mine) {
                    publish(before);
                }

                setError(failure instanceof Error ? failure.message : "the setting was not saved");
            }
        })();
    };

    return (
        <>
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-faint shrink-0">branch</span>
                <span className="text-meta text-muted min-w-0 truncate font-mono">
                    {name ?? "none"}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <input
                    id={control}
                    type="checkbox"
                    checked={showInStatusBar}
                    onChange={(event) => {
                        change(event.target.checked);
                    }}
                    className="accent-accent size-3.5"
                />
                <label htmlFor={control} className="text-meta text-muted">
                    Show in status bar
                </label>
            </div>
            {error === null ? null : (
                <p role="alert" className="text-meta text-danger">
                    {error}
                </p>
            )}
        </>
    );
}

export default {
    status: [{ id: "branch", slot: "start", component: Branch }],
    settings: [{ id: "git", title: "Git", component: Git }],
} satisfies WebExtension;
