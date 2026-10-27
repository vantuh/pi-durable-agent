import { useEffect, useState } from "react";

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
    setDefaultModel,
} from "./lib/api.ts";
import { useConversation } from "./lib/conversation.ts";
import { useRoute } from "./lib/route.ts";
import { useSeen } from "./lib/seen.ts";
import { useSessionList } from "./lib/session-list.ts";
import { useFinishedToasts } from "./shell/finished-toasts.tsx";
import { FolderPicker } from "./shell/folder-picker.tsx";
import { HeaderItems } from "./shell/header-items.tsx";
import { Home } from "./shell/home.tsx";
import { PanelButtons, PanelHost, panelKey } from "./shell/panels.tsx";
import { Sessions } from "./shell/sessions.tsx";
import { Settings } from "./shell/settings.tsx";
import { StatusBar } from "./shell/status-bar.tsx";
import { Transcript } from "./transcript/transcript.tsx";
import { StatusItems } from "./ui/status-fields.tsx";

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
    const { sessions, setSessions, connected } = useSessionList();
    const [current, go] = useRoute();
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
                go(id);
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
                    folder={folder}
                    onHome={() => {
                        go(null);
                        setSheet(false);
                    }}
                    onArchive={async (id, archived) => {
                        await setSessionArchived(id, archived);
                        setSessions((rows) =>
                            rows.map((row) => (row.id === id ? { ...row, archived } : row)),
                        );
                    }}
                    onDelete={async (id) => {
                        await deleteSession(id);
                        setSessions((rows) => rows.filter((row) => row.id !== id));

                        if (id === current) {
                            go(null);
                        }
                    }}
                    onRename={async (id, name) => {
                        await setSessionTitle(id, name);
                        setSessions(await listSessions());
                    }}
                    onSelect={(id) => {
                        go(id);
                        setSheet(false);
                    }}
                    onFolder={go}
                    onNew={() => {
                        setPicker(true);
                    }}
                    open={sheet}
                    onClose={() => {
                        setSheet(false);
                    }}
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
                            onSettings={() => {
                                setSettings(true);
                            }}
                        />
                    ) : (
                        <>
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
                                below={<StatusItems slot="title" session={activeSession} />}
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
                                        openSession(
                                            active?.cwd ?? health?.cwd ?? health?.home ?? "/",
                                        );
                                    }}
                                />
                            </div>

                            <SessionMeta
                                session={activeSession}
                                status={state.live.status ?? []}
                                usage={state.live.usage}
                            />
                        </>
                    )}
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
                // The session list streams the whole time; a conversation's own stream starts over at each switch.
                connected={connected}
                session={activeSession}
                status={state.live.status ?? []}
                busy={state.live.busy}
                issue={state.issue}
                sessions={sessions}
                current={current}
                onOpen={(id) => {
                    go(id);
                    setSheet(false);
                }}
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
