import { useEffect, useState } from "react";

import type { SessionSummary } from "../../shared/protocol.ts";
import {
    type Health,
    createSession,
    getHealth,
    type Models,
    listModels,
    listSessions,
    setAgent,
    setDefaultModel,
} from "./lib/api.ts";
import { useConversation } from "./lib/conversation.ts";
import { type Flavour, currentFlavour } from "./lib/flavour.ts";
import { Composer } from "./parts/composer.tsx";
import { FolderPicker } from "./parts/folder-picker.tsx";
import { ModelMenu } from "./parts/model-menu.tsx";
import { Sessions } from "./parts/sessions.tsx";
import { Settings } from "./parts/settings.tsx";
import { StatusBar } from "./parts/status-bar.tsx";
import { Transcript } from "./parts/transcript.tsx";

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
    const [flavour, setFlavour] = useState<Flavour>(currentFlavour);
    const [settings, setSettings] = useState(false);

    const { state, send, stop } = useConversation(current);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const [info, rows] = await Promise.all([getHealth(), listSessions()]);

            if (!alive) {
                return;
            }

            setHealth(info);
            setSessions(rows);
            setCurrent(rows[0]?.id ?? info?.session ?? null);
        })();

        return () => {
            alive = false;
        };
    }, []);

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

    const active = sessions.find((session) => session.id === current);
    const model = shortName(active?.model ?? null);

    return (
        <div className="bg-sunken flex h-full flex-col gap-2 p-2">
            <div className="flex min-h-0 flex-1 items-stretch gap-2">
                <Sessions
                    sessions={sessions}
                    current={current}
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

                <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                    <Transcript
                        title={active?.title ?? null}
                        entries={state.entries}
                        live={state.live}
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
                        />
                    </div>
                </main>

                {settings ? (
                    <Settings
                        flavour={flavour}
                        model={active?.model ?? ""}
                        cwd={active?.cwd ?? ""}
                        branch={active?.branch ?? null}
                        onFlavour={setFlavour}
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
                session={
                    current === null
                        ? null
                        : {
                              id: current,
                              cwd: active?.cwd ?? health?.cwd ?? null,
                              busy: state.live.busy,
                          }
                }
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
                        void (async () => {
                            const id = await createSession(path);

                            if (id !== 0) {
                                setCurrent(id);
                            }

                            await reload();
                        })();
                    }}
                />
            ) : null}
        </div>
    );
}
