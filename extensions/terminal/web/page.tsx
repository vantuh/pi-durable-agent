import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type { PageProps } from "@/sdk/types.ts";

import { messageOf } from "../../../shared/guards.ts";
import { GONE, type Tab, create, list, remove, state } from "../refs.ts";
import { Shell } from "./shell.tsx";
import { StopDialog } from "./stop-dialog.tsx";

/** How often the tabs are re-read: a title follows what runs in it, and another session may add a tab. */
const LIST_MS = 2000;

/** The tab each folder showed last, so the page comes back to it. */
const lastTab = new Map<string, number>();

/**
 * The folder's shells, one per tab. Only the active tab is mounted: each mounted shell holds a long-poll
 * open, and a browser allows six connections to one host.
 */
export function TerminalPage({ session, close }: PageProps) {
    const id = session.id;
    const folder = session.cwd ?? "";
    // Keyed by session: another session's tabs are never drawn while this one's are on their way.
    const [data, setData] = useState<{ id: number; tabs: Tab[] } | null>(null);
    const tabs = data?.id === id ? data.tabs : null;
    const [, setPicked] = useState(0);
    const chosen = lastTab.get(folder);
    // A new shell is a new terminal: the effect starts again instead of reusing what the old one fitted.
    const [generation, setGeneration] = useState(0);
    const [problem, setProblem] = useState<string | null>(null);
    const [poke, setPoke] = useState(0);
    /** The tab whose × was pressed while a program runs in it, and the × to give focus back to. */
    const [ask, setAsk] = useState<{ tab: number; process: string; from: HTMLElement } | null>(
        null,
    );

    const choose = (tab: number): void => {
        lastTab.set(folder, tab);
        setPicked(tab);
    };

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const update = async (): Promise<void> => {
            try {
                let found = await callAction(list, undefined, id);

                // An open page is asking for a shell: a folder without one gets its first tab.
                if (alive && found.length === 0) {
                    await callAction(create, undefined, id);
                    found = await callAction(list, undefined, id);
                }

                if (alive) {
                    setData({ id, tabs: found });
                    setProblem(null);
                }
            } catch (failure) {
                if (alive) {
                    setProblem(messageOf(failure));
                }
            }

            if (alive) {
                timer = setTimeout(() => {
                    void update();
                }, LIST_MS);
            }
        };

        void update();

        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a tab added or closed here is re-read at once, not on the next tick
    }, [id, poke]);

    const active = tabs?.find((tab) => tab.id === chosen) ?? tabs?.[0];

    const added = async (): Promise<void> => {
        try {
            choose(await callAction(create, undefined, id));
            setPoke((value) => value + 1);
        } catch (failure) {
            setProblem(messageOf(failure));
        }
    };

    const removed = (tab: number): void => {
        const left = (tabs ?? []).filter((each) => each.id !== tab);
        const at = (tabs ?? []).findIndex((each) => each.id === tab);
        const next = left[Math.max(0, at - 1)];

        // The last tab closed is the terminal closed: back to the conversation.
        if (next === undefined) {
            close("composer");

            return;
        }

        choose(next.id);
        setData({ id, tabs: left });
        setPoke((value) => value + 1);
    };

    /** A tab's ×: asks first when a program runs in it, as the toolbar's Close does, then ends the tab. */
    const closing = async (tab: number, from: HTMLElement, sure = false): Promise<void> => {
        try {
            if (!sure) {
                const running = await callAction(state, { tab }, id);

                if (running.foreground !== running.shell) {
                    setAsk({ tab, process: running.foreground, from });

                    return;
                }
            }

            await callAction(remove, { tab }, id);
        } catch (failure) {
            const message = messageOf(failure);

            // A tab whose shell is already gone is the outcome this asks for.
            if (!message.includes(GONE)) {
                setProblem(message);

                return;
            }
        }

        removed(tab);
    };

    // The last shell stopping closes the terminal; a stopped tab beside others stays, to be restarted.
    const ended = async (tab: number): Promise<void> => {
        try {
            const found = await callAction(list, undefined, id);

            if (found.length === 1 && found[0]?.id === tab) {
                await callAction(remove, { tab }, id);
                close("composer");
            }
        } catch (failure) {
            setProblem(messageOf(failure));
        }
    };

    const strip =
        active === undefined || tabs === null ? null : (
            <div className="flex min-w-0 items-center gap-1">
                <Tabs
                    value={String(active.id)}
                    onValueChange={(value) => {
                        choose(Number(value));
                    }}
                    className="min-w-0"
                >
                    <TabsList className="overflow-x-auto p-0">
                        {tabs.map((tab) => (
                            <div key={tab.id} className="flex flex-none items-center">
                                <TabsTrigger value={String(tab.id)} className="flex-none py-0.5">
                                    {tab.title}
                                </TabsTrigger>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Close ${tab.title}`}
                                    onClick={(event) => {
                                        void closing(tab.id, event.currentTarget);
                                    }}
                                >
                                    <X className="size-3" />
                                </Button>
                            </div>
                        ))}
                    </TabsList>
                </Tabs>
                <Hint label="New tab">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="New tab"
                        onClick={() => {
                            void added();
                        }}
                    >
                        <Plus className="size-4" />
                    </Button>
                </Hint>
            </div>
        );

    return (
        <div className="flex h-full min-h-0 flex-col">
            {problem === null ? null : <Alert className="text-interface">{problem}</Alert>}
            {ask === null ? null : (
                <StopDialog
                    ask={{ what: "remove", process: ask.process }}
                    onCancel={() => {
                        setAsk(null);
                    }}
                    onConfirm={() => {
                        setAsk(null);
                        void closing(ask.tab, ask.from, true);
                    }}
                    onCloseFocus={() => {
                        if (ask.from.isConnected) {
                            ask.from.focus();
                        }
                    }}
                />
            )}
            {active === undefined ? null : (
                <Shell
                    key={`${String(active.id)}:${String(generation)}`}
                    id={id}
                    tab={active.id}
                    tabs={strip}
                    onRestart={() => {
                        setGeneration((value) => value + 1);
                    }}
                    onRemoved={() => {
                        removed(active.id);
                    }}
                    onEnded={() => {
                        void ended(active.id);
                    }}
                />
            )}
        </div>
    );
}
