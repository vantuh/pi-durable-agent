import { useEffect, useState } from "react";

import type { SessionSummary } from "../../shared/protocol.ts";
import { Composer } from "./composer/composer.tsx";
import { ModelMenu } from "./composer/model-menu.tsx";
import { usePanels } from "./extensions.ts";
import {
    type Health,
    createSession,
    deleteSession,
    getHealth,
    type Models,
    listModels,
    listSessions,
    setAgent,
    setSessionArchived,
    setSessionTitle,
    setDefaultModel,
} from "./lib/api.ts";
import { useConversation } from "./lib/conversation.ts";
import { sessionFromSearch } from "./lib/deep-link.ts";
import { useSeen } from "./lib/seen.ts";
import { FolderPicker } from "./shell/folder-picker.tsx";
import { HeaderItems } from "./shell/header-items.tsx";
import { PanelButtons, PanelHost, panelKey } from "./shell/panels.tsx";
import { Sessions } from "./shell/sessions.tsx";
import { Settings } from "./shell/settings.tsx";
import { StatusBar } from "./shell/status-bar.tsx";
import { Transcript } from "./transcript/transcript.tsx";

const SESSION_KEY = "session";

function shortName(model: string | null): string {
    if (model === null) {
        return "";
    }

    const parts = model.split("/");

    return parts[parts.length - 1] ?? model;
}

export function App() {
    const [health, setHealth] = useState<Health | undefined>(undefined);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [current, setCurrent] = useState<number | null>(null);
    const [picker, setPicker] = useState(false);
    const [menu, setMenu] = useState(false);
    const [models, setModels] = useState<Models>({ scoped: [], all: [], default: null });
    const [sheet, setSheet] = useState(false);
    const [settings, setSettings] = useState(false);
    const [panelOpen, setPanelOpen] = useState<string | null>(null);
    const panels = usePanels();

    const { state, send, stop, loadOlder } = useConversation(current);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const [info, rows] = await Promise.all([getHealth(), listSessions()]);

            if (!alive) {
                return;
            }

            setHealth(info);
            setSessions(rows);
            const linked = rows.find((row) => row.id === sessionFromSearch(location.search));
            const saved = rows.find((row) => String(row.id) === localStorage.getItem(SESSION_KEY));

            setCurrent(linked?.id ?? saved?.id ?? rows[0]?.id ?? info?.session ?? null);
        })();

        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (current !== null) {
            localStorage.setItem(SESSION_KEY, String(current));
        }
    }, [current]);

    const reload = async (): Promise<void> => {
        setSessions(await listSessions());
    };

    useEffect(() => {
        let alive = true;

        void (async () => {
            const rows = await listSessions();

            if (alive) {
                setSessions(rows);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run starting, ending or adding a message is the trigger: a title, a time and a busy dot change then
    }, [state.live.busy, state.entries.length]);

    // Only the open session streams; the rest are known by asking, for as long as any is at work.
    const someBusy = sessions.some((session) => session.busy);

    useEffect(() => {
        const tick = setInterval(() => {
            if (someBusy) {
                void reload();
            }
        }, 4000);

        return () => {
            clearInterval(tick);
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `reload` only sets state from a fetch
    }, [someBusy]);

    const active = sessions.find((session) => session.id === current);

    useSeen(current, active?.unseen === true, (id) => {
        setSessions((rows) => rows.map((row) => (row.id === id ? { ...row, unseen: false } : row)));
    });

    const model = shortName(active?.model ?? null);
    const activeSession =
        current === null
            ? null
            : {
                  id: current,
                  cwd: active?.cwd ?? health?.cwd ?? null,
                  busy: state.live.busy,
                  model: active?.model ?? null,
              };

    const panel = panels.find((candidate) => panelKey(candidate) === panelOpen);

    // A new session in `path`, opened at once.
    const openSession = (path: string): void => {
        void (async () => {
            const id = await createSession(path);

            if (id !== 0) {
                setCurrent(id);
                setSheet(false);
            }

            await reload();
        })();
    };

    return (
        <div className="bg-sunken flex h-full flex-col gap-2 p-2">
            <div className="flex min-h-0 flex-1 items-stretch gap-2">
                <Sessions
                    sessions={sessions}
                    current={current}
                    onArchive={async (id, archived) => {
                        await setSessionArchived(id, archived);
                        setSessions((rows) =>
                            rows.map((row) => (row.id === id ? { ...row, archived } : row)),
                        );
                    }}
                    onDelete={async (id) => {
                        await deleteSession(id);
                        const rows = (await listSessions()).filter((row) => row.id !== id);

                        setSessions(rows);

                        if (id === current) {
                            setCurrent(rows[0]?.id ?? null);
                        }
                    }}
                    onRename={async (id, name) => {
                        await setSessionTitle(id, name);
                        setSessions(await listSessions());
                    }}
                    onSelect={(id) => {
                        setCurrent(id);
                        setSheet(false);
                    }}
                    onFolder={setCurrent}
                    onNew={() => {
                        setPicker(true);
                    }}
                    open={sheet}
                    onClose={() => {
                        setSheet(false);
                    }}
                />

                <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:min-w-[320px]">
                    <Transcript
                        key={current}
                        title={active?.title ?? null}
                        entries={state.entries}
                        live={state.live}
                        loadingOlder={state.loadingOlder}
                        exhausted={state.exhausted}
                        onLoadOlder={loadOlder}
                        tools={
                            <>
                                <HeaderItems session={activeSession} />
                                <PanelButtons
                                    panels={panels}
                                    open={panelOpen}
                                    onToggle={(key) => {
                                        setPanelOpen((open) => (open === key ? null : key));
                                    }}
                                />
                            </>
                        }
                        onSettings={() => {
                            setSettings(true);
                        }}
                        onSessions={() => {
                            setSheet(true);
                        }}
                    />

                    <div className="relative">
                        {menu ? (
                            <ModelMenu
                                scoped={models.scoped}
                                all={models.all}
                                current={active?.model ?? null}
                                level={active?.thinkingLevel ?? null}
                                defaultModel={models.default}
                                onClose={() => {
                                    setMenu(false);
                                }}
                                onMakeDefault={(choice, level) => {
                                    void (async () => {
                                        await setDefaultModel({
                                            provider: choice.provider,
                                            modelId: choice.id,
                                            thinkingLevel: level,
                                        });
                                        setModels(await listModels());
                                    })();
                                }}
                                onPick={(choice, level) => {
                                    void (async () => {
                                        if (current !== null) {
                                            await setAgent(current, {
                                                model: {
                                                    provider: choice.provider,
                                                    modelId: choice.id,
                                                },
                                                thinkingLevel: level,
                                            });
                                        }

                                        await reload();
                                    })();
                                }}
                            />
                        ) : null}

                        <Composer
                            key={current}
                            sessionId={String(current)}
                            session={activeSession}
                            busy={state.live.busy}
                            queued={state.live.queued ?? []}
                            model={model}
                            level={active?.thinkingLevel ?? null}
                            menuOpen={menu}
                            onToggleMenu={() => {
                                void (async () => {
                                    if (!menu) {
                                        setModels(await listModels());
                                    }

                                    setMenu((open) => !open);
                                })();
                            }}
                            onSend={send}
                            onStop={() => {
                                void stop();
                            }}
                            onNewSession={() => {
                                openSession(active?.cwd ?? health?.cwd ?? health?.home ?? "/");
                            }}
                        />
                    </div>
                </main>

                {panel === undefined ? null : (
                    <PanelHost
                        panel={panel}
                        session={activeSession}
                        onClose={() => {
                            setPanelOpen(null);
                        }}
                    />
                )}

                {settings ? (
                    <Settings
                        model={active?.model ?? ""}
                        cwd={active?.cwd ?? ""}
                        session={activeSession}
                        onClose={() => {
                            setSettings(false);
                        }}
                    />
                ) : null}
            </div>

            <StatusBar
                connected={state.connected}
                cwd={active?.cwd ?? health?.cwd ?? ""}
                home={health?.home ?? ""}
                session={activeSession}
                usage={state.live.usage}
                status={state.live.status ?? []}
                busy={state.live.busy}
                issue={state.issue}
            />

            {picker ? (
                <FolderPicker
                    start={active?.cwd ?? health?.cwd ?? health?.home ?? "/"}
                    recent={sessions.map((session) => session.cwd).filter((cwd) => cwd !== null)}
                    onClose={() => {
                        setPicker(false);
                    }}
                    onOpen={(path) => {
                        setPicker(false);
                        openSession(path);
                    }}
                />
            ) : null}
        </div>
    );
}
