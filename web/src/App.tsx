import { useCallback, useEffect, useMemo, useState } from "react";

import type { ClientStatus } from "../../shared/protocol.ts";
import { AboveComposerItems } from "./composer/above-items.tsx";
import { Composer } from "./composer/composer.tsx";
import { SessionMeta } from "./composer/meta.tsx";
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
    addScopedModel,
    removeScopedModel,
    setDefaultModel,
} from "./lib/api.ts";
import { useConversation } from "./lib/conversation.ts";
import { useRoute } from "./lib/route.ts";
import { useSeen } from "./lib/seen.ts";
import { useSessionList } from "./lib/session-list.ts";
import { useShellCommand } from "./sdk/commands.ts";
import { useFinishedToasts } from "./shell/finished-toasts.tsx";
import { FolderPicker } from "./shell/folder-picker.tsx";
import { HeaderItems } from "./shell/header-items.tsx";
import { Home } from "./shell/home.tsx";
import { PanelButtons, PanelHost, panelKey, useOpenPanel } from "./shell/panels.tsx";
import { Sessions } from "./shell/sessions.tsx";
import { Settings } from "./shell/settings.tsx";
import { StatusBar } from "./shell/status-bar.tsx";
import { Transcript } from "./transcript/transcript.tsx";
import { StatusItems } from "./ui/status-fields.tsx";

const SESSION_KEY = "session";
// A new array per render would defeat the status bar's memo on every frame.
const NO_STATUS: ClientStatus[] = [];

function shortName(model: string | null): string {
    if (model === null) {
        return "";
    }

    const parts = model.split("/");

    return parts[parts.length - 1] ?? model;
}

export function App() {
    const [health, setHealth] = useState<Health | undefined>(undefined);
    const { sessions, setSessions, connected } = useSessionList();
    const [current, go] = useRoute();
    const [picker, setPicker] = useState(false);
    const [menu, setMenu] = useState(false);
    const [models, setModels] = useState<Models>({ scoped: [], all: [], default: null });
    const [sheet, setSheet] = useState(false);
    const [settings, setSettings] = useState(false);
    // The panel stays mounted to animate; each open remounts its sections, which read on mount.
    const [settingsEpoch, setSettingsEpoch] = useState(0);
    const panels = usePanels();

    const { state, send, stop, loadOlder } = useConversation(current);
    const {
        shown: panelShown,
        open: panelOpen,
        setOpen: setPanelOpen,
        forget: forgetPanel,
    } = useOpenPanel(current);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const info = await getHealth();

            if (alive) {
                setHealth(info);
            }
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

    // The stream catches up a moment later; an action's own result is shown at once.
    const reload = async (): Promise<void> => {
        setSessions(await listSessions());
    };

    const active = sessions.find((session) => session.id === current);

    // The conversation on screen answers with its own state: until its hello arrives, what is shown is not an empty
    // session, it is one that has not been read yet.
    const loading = current !== null && state.session !== current;

    // The tab, and an installed window, carry the session's name; the list streams a rename at once.
    useEffect(() => {
        document.title = active?.title ? `Pi · ${active.title}` : "Pi";
    }, [active?.title]);

    useFinishedToasts(sessions, current, (id) => {
        go(id);
        setSheet(false);
    });

    // The home page has no session; the sidebar keeps showing the folder of the last one opened.
    const last = sessions.find(
        (session) => String(session.id) === localStorage.getItem(SESSION_KEY),
    );
    const folder = (active ?? last)?.cwd ?? health?.cwd ?? null;

    useSeen(current, active?.unseen === true, (id) => {
        setSessions((rows) => rows.map((row) => (row.id === id ? { ...row, unseen: false } : row)));
    });

    const model = shortName(active?.model ?? null);
    const sessionCwd = active?.cwd ?? health?.cwd ?? null;
    const activeModel = active?.model ?? null;
    const { busy } = state.live;
    const revision = state.live.revision ?? 0;
    // Stable between frames, so the memoized sidebar and status bar skip the ones that only grow the reply.
    const knownSession = useMemo(
        () =>
            current === null
                ? null
                : { id: current, cwd: sessionCwd, busy, revision, model: activeModel },
        [current, sessionCwd, busy, revision, activeModel],
    );
    // Extensions refetch when the session they get changes. Until the list and the conversation's hello have both
    // arrived, its folder, revision and busy flag are guesses that change a moment later, so they get no session.
    const activeSession = loading || active === undefined ? null : knownSession;

    const panel = panels.find((candidate) => panelKey(candidate) === panelShown);

    const toggleSettings = (): void => {
        if (settings) {
            setSettings(false);

            return;
        }

        setSettings(true);
        setSettingsEpoch(settingsEpoch + 1);
    };

    const select = useCallback(
        (id: number | null) => {
            go(id);
            setSheet(false);
        },
        [go],
    );
    const home = useCallback(() => {
        select(null);
    }, [select]);
    const archive = useCallback(
        async (id: number, archived: boolean) => {
            await setSessionArchived(id, archived);
            setSessions((rows) => rows.map((row) => (row.id === id ? { ...row, archived } : row)));
        },
        [setSessions],
    );
    const remove = useCallback(
        async (id: number) => {
            await deleteSession(id);
            setSessions((rows) => rows.filter((row) => row.id !== id));

            if (id === current) {
                go(null);
            }
        },
        [setSessions, current, go],
    );
    const rename = useCallback(
        async (id: number, name: string) => {
            await setSessionTitle(id, name);
            setSessions(await listSessions());
        },
        [setSessions],
    );
    const askFolder = useCallback(() => {
        setPicker(true);
    }, []);
    const closeSheet = useCallback(() => {
        setSheet(false);
    }, []);

    // A new session in `path`, opened at once.
    const openSession = (path: string): void => {
        void (async () => {
            const id = await createSession(path);

            if (id !== 0) {
                go(id);
                setSheet(false);
            }

            await reload();
        })();
    };

    useShellCommand("session.new", () => {
        const start = folder ?? health?.home ?? null;

        if (start === null) {
            setPicker(true);
        } else {
            openSession(start);
        }
    });

    return (
        <div className="bg-sunken flex h-full flex-col gap-2 p-2">
            <div className="flex min-h-0 flex-1 items-stretch gap-2">
                <Sessions
                    sessions={sessions}
                    current={current}
                    session={activeSession}
                    folder={folder}
                    onHome={home}
                    onArchive={archive}
                    onDelete={remove}
                    onRename={rename}
                    onSelect={select}
                    onFolder={go}
                    onNew={askFolder}
                    open={sheet}
                    onClose={closeSheet}
                />

                <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:min-w-[320px]">
                    {current === null ? (
                        <Home
                            sessions={sessions}
                            onOpen={go}
                            onNew={() => {
                                setPicker(true);
                            }}
                            onSessions={() => {
                                setSheet(true);
                            }}
                            onSettings={toggleSettings}
                        />
                    ) : (
                        <>
                            <Transcript
                                key={current}
                                session={current}
                                title={active?.title ?? null}
                                entries={state.entries}
                                live={state.live}
                                exhausted={state.exhausted}
                                loading={loading}
                                onLoadOlder={loadOlder}
                                tools={
                                    <>
                                        <HeaderItems session={activeSession} />
                                        <PanelButtons
                                            panels={panels}
                                            session={activeSession}
                                            open={panelShown}
                                            onToggle={(key) => {
                                                setPanelOpen(
                                                    panelOpen && panelShown === key ? null : key,
                                                );
                                            }}
                                        />
                                    </>
                                }
                                onSettings={toggleSettings}
                                onSessions={() => {
                                    setSheet(true);
                                }}
                                onOpenSession={go}
                                below={
                                    <StatusItems
                                        slot="title"
                                        session={activeSession}
                                        sessions={sessions}
                                        openSession={go}
                                    />
                                }
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
                                        onAddScoped={(choice) => {
                                            void (async () => {
                                                await addScopedModel(choice);
                                                setModels(await listModels());
                                            })();
                                        }}
                                        onRemoveScoped={(choice) => {
                                            void (async () => {
                                                await removeScopedModel(choice);
                                                setModels(await listModels());
                                            })();
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
                                    above={
                                        <AboveComposerItems
                                            session={activeSession}
                                            openSession={go}
                                        />
                                    }
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
                                        openSession(
                                            active?.cwd ?? health?.cwd ?? health?.home ?? "/",
                                        );
                                    }}
                                />
                            </div>

                            <SessionMeta
                                session={activeSession}
                                sessions={sessions}
                                status={state.live.status ?? []}
                                usage={state.live.usage}
                                openSession={go}
                            />
                        </>
                    )}
                </main>

                {panel === undefined ? null : (
                    <PanelHost
                        panel={panel}
                        session={knownSession}
                        open={panelOpen}
                        onClose={() => {
                            setPanelOpen(null);
                        }}
                        onLeft={forgetPanel}
                    />
                )}

                <Settings
                    model={active?.model ?? ""}
                    cwd={active?.cwd ?? ""}
                    session={activeSession}
                    open={settings}
                    epoch={settingsEpoch}
                    onClose={() => {
                        setSettings(false);
                    }}
                />
            </div>

            <StatusBar
                // The session list streams the whole time; a conversation's own stream starts over at each switch.
                connected={connected}
                session={activeSession}
                status={state.live.status ?? NO_STATUS}
                busy={busy}
                issue={state.issue}
                sessions={sessions}
                current={current}
                onOpen={select}
            />

            {picker ? (
                <FolderPicker
                    start={folder ?? health?.home ?? "/"}
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
