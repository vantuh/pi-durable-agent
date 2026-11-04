import { PanelRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, REACH } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

import type { ClientQueued, ClientStatus } from "../../shared/protocol.ts";
import { AboveComposerItems } from "./composer/above-items.tsx";
import { Composer } from "./composer/composer.tsx";
import { SessionMeta } from "./composer/meta.tsx";
import { ModelMenu } from "./composer/model-menu.tsx";
import { useExtensionsLoaded, usePages, usePanels } from "./extensions.ts";
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
import { noticeTarget } from "./lib/notice.ts";
import { useRoute } from "./lib/route.ts";
import { useSeen } from "./lib/seen.ts";
import { useSessionList } from "./lib/session-list.ts";
import { useShellCommand } from "./sdk/commands.ts";
import { focusComposer } from "./sdk/composer.ts";
import { useEdgeSwipe } from "./shell/edge-swipe.ts";
import { useFinishedToasts } from "./shell/finished-toasts.tsx";
import { FolderPicker } from "./shell/folder-picker.tsx";
import { HeaderItems } from "./shell/header-items.tsx";
import { Home } from "./shell/home.tsx";
import { PageHost, pageKey } from "./shell/pages.tsx";
import { PanelHost, panelKey, useOpenPanel } from "./shell/panels.tsx";
import { showSessionAlert } from "./shell/session-alert.tsx";
import { Sessions } from "./shell/sessions.tsx";
import { Settings } from "./shell/settings.tsx";
import { StatusBar } from "./shell/status-bar.tsx";
import { ExtensionTabs } from "./shell/tabs.tsx";
import { Transcript } from "./transcript/transcript.tsx";
import { StatusItems } from "./ui/status-fields.tsx";

const SESSION_KEY = "session";
// A new array per render would defeat the status bar's memo on every frame.
const NO_STATUS: ClientStatus[] = [];
// The same goes for the composer's queue: a frame of a reply passes it straight through.
const NO_QUEUED: ClientQueued[] = [];

function shortName(model: string | null): string {
    if (model === null) {
        return "";
    }

    const parts = model.split("/");

    return parts[parts.length - 1] ?? model;
}

export function App() {
    const [health, setHealth] = useState<Health | undefined>(undefined);
    const { route, go, openPage, setPageSub, backPage, closePage, dropPage } = useRoute();
    const current = route.session;
    const [picker, setPicker] = useState(false);
    const [menu, setMenu] = useState(false);
    const [models, setModels] = useState<Models>({ scoped: [], all: [], default: null });
    const [sheet, setSheet] = useState(false);
    const [settings, setSettings] = useState(false);
    const settingsGear = useRef<HTMLButtonElement>(null);
    const panels = usePanels();
    const pages = usePages();
    const extensionsLoaded = useExtensionsLoaded();

    const goToSession = useCallback(
        (id: number) => {
            go(id);
            setSheet(false);
        },
        [go],
    );
    // The list stream is the one every tab holds, so a notice about any session arrives here, the home page included.
    const { sessions, setSessions, connected } = useSessionList((notice) => {
        const target = noticeTarget(notice, current);

        if (target.kind === "session") {
            showSessionAlert(target, goToSession);
        }
    });

    const { state, send, stop, loadOlder } = useConversation(current);
    const {
        shown: panelShown,
        last: panelLast,
        open: panelOpen,
        setOpen: setPanelOpen,
        forget: forgetPanel,
    } = useOpenPanel(current);
    // A panel may fill the conversation instead of the drawer; it is the panel's own choice, dropped when
    // the panel closes.
    const [expanded, setExpanded] = useState<{ session: number | null; panel: string } | null>(
        null,
    );

    // A session change starts in the drawer, even one coming back to a session that was expanded: an open
    // panel is remembered per session, so the mode must not outlive the visit that asked for it. Adjusted
    // during render, as React asks: the state is only ever wrong for the render that sees the change.
    if (expanded !== null && expanded.session !== current) {
        setExpanded(null);
    }

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
    const reload = useCallback(async (): Promise<void> => {
        setSessions(await listSessions());
    }, [setSessions]);

    const active = sessions.find((session) => session.id === current);

    // The conversation on screen answers with its own state: until its hello arrives, what is shown is not an empty
    // session, it is one that has not been read yet.
    const loading = current !== null && state.session !== current;

    // The tab, and an installed window, carry the session's name; the list streams a rename at once.
    useEffect(() => {
        document.title = active?.title ? `Pi · ${active.title}` : "Pi";
    }, [active?.title]);

    useFinishedToasts(sessions, current, goToSession);

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
    const { input: usageInput, output: usageOutput, cost: usageCost } = state.live.usage;
    // A frame carries a new usage object every time; the line under the composer shows the numbers in it, not the
    // object, and only changes when one of them does.
    const usage = useMemo(
        () => ({ input: usageInput, output: usageOutput, cost: usageCost }),
        [usageInput, usageOutput, usageCost],
    );
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
    const openPageItem =
        route.page === null
            ? undefined
            : pages.find((candidate) => pageKey(candidate) === route.page?.key);
    const pageOpen = openPageItem !== undefined;
    const panelExpanded =
        panelOpen &&
        !pageOpen && // a page reached by browser Back while the panel was open is not made inert by it
        expanded !== null &&
        expanded.session === current &&
        expanded.panel === panelShown;
    // Closing the panel drops the mode with it, so reopening it comes back to the drawer.
    const closePanel = useCallback(() => {
        setPanelOpen(null);
        setExpanded(null);
    }, [setPanelOpen]);
    const setPanelExpanded = useCallback(
        (value: boolean) => {
            setExpanded(
                value && panelShown !== null ? { session: current, panel: panelShown } : null,
            );
        },
        [current, panelShown],
    );

    // The address may name a page no folder answers — turned off, or a typo. Once the folders are in,
    // the address is rewritten to the conversation instead of keeping a frame with nothing in it.
    useEffect(() => {
        if (extensionsLoaded && route.page !== null && openPageItem === undefined) {
            dropPage();
        }
    }, [extensionsLoaded, route.page, openPageItem, dropPage]);
    // The page hides the conversation's controls; on the way out the keyboard goes back to the composer,
    // or, when a panel tab took its place, to that tab.
    const pendingFocus = useRef<"composer" | "tab" | null>(null);
    const hadPage = useRef(false);

    useEffect(() => {
        if (pageOpen) {
            hadPage.current = true;
            return;
        }

        if (!hadPage.current) {
            return;
        }

        hadPage.current = false;

        const asked = pendingFocus.current;
        const lost = document.activeElement === null || document.activeElement === document.body;

        pendingFocus.current = null;

        if (asked === "tab") {
            document.querySelector<HTMLElement>('[data-slot="panel-host"] [aria-current]')?.focus();
            return;
        }

        // Back out of the page leaves focus on nothing; a moved-away session keeps its own focus.
        if (asked === "composer" || lost) {
            focusComposer();
        }
    }, [pageOpen]);

    const leavePage = useCallback(() => {
        pendingFocus.current = "composer";
        // Leaving by the page's own close or the toggle also forgets the panel, so it does not come back under it.
        closePanel();
        closePage();
    }, [closePanel, closePage]);
    const sidebarOpen = pageOpen || (panelOpen && panel !== undefined);
    const selectPanel = useCallback(
        (key: string) => {
            if (pageOpen) {
                pendingFocus.current = "tab";
            }

            closePage();
            setPanelOpen(key);
        },
        [pageOpen, closePage, setPanelOpen],
    );
    const selectPage = useCallback(
        (key: string) => {
            if (route.page?.key !== key) {
                closePanel();
                openPage(key);
            }
        },
        [route.page?.key, closePanel, openPage],
    );
    // Closed, it brings back the panel opened last, else the first panel, else the first page.
    const toggleSidebar = (): void => {
        if (sidebarOpen) {
            leavePage();
            return;
        }

        const first = panels.find((candidate) => panelKey(candidate) === panelLast) ?? panels[0];

        if (first !== undefined) {
            setPanelOpen(panelKey(first));
        } else if (pages[0] !== undefined) {
            openPage(pageKey(pages[0]));
        }
    };
    const tabs = (
        <ExtensionTabs
            panels={panels}
            pages={pages}
            session={activeSession}
            panel={pageOpen ? null : panelShown}
            page={openPageItem === undefined ? null : pageKey(openPageItem)}
            onPanel={selectPanel}
            onPage={selectPage}
        />
    );

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

    const openSheet = useCallback(() => {
        setSheet(true);
    }, []);

    useEdgeSwipe(openSheet);

    // A new session in `path`, opened at once.
    const openSession = useCallback(
        (path: string): void => {
            void (async () => {
                const id = await createSession(path);

                if (id !== 0) {
                    go(id);
                    setSheet(false);
                }

                await reload();
            })();
        },
        [go, reload],
    );

    // The screen around the reply keeps its props across a frame, so none of it renders again for one. Every fresh
    // function or element below would defeat that memo.
    const aboveComposer = useMemo(
        () => <AboveComposerItems session={activeSession} openSession={go} />,
        [activeSession, go],
    );
    const toggleMenu = useCallback((): void => {
        void (async () => {
            if (!menu) {
                setModels(await listModels());
            }

            setMenu((open) => !open);
        })();
    }, [menu]);
    const stopRun = useCallback((): void => {
        void stop();
    }, [stop]);
    const newSession = useCallback((): void => {
        openSession(active?.cwd ?? health?.cwd ?? health?.home ?? "/");
    }, [openSession, active?.cwd, health?.cwd, health?.home]);

    useShellCommand("session.new", () => {
        const start = folder ?? health?.home ?? null;

        if (start === null) {
            setPicker(true);
        } else {
            openSession(start);
        }
    });

    return (
        <div className="bg-sunken flex h-full flex-col">
            {/* Positioned: a panel that fills the conversation measures its place from this row. */}
            <div className="relative flex min-h-0 flex-1 items-stretch">
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

                <main
                    data-slot="conversation"
                    inert={panelExpanded}
                    className="bg-canvas relative flex min-h-0 min-w-0 flex-1 flex-col lg:min-w-80"
                >
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
                        />
                    ) : (
                        <>
                            <div
                                className={`flex min-h-0 flex-1 flex-col ${pageOpen || panelExpanded ? "invisible" : ""}`}
                                inert={pageOpen || panelExpanded}
                            >
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
                                            {panels.length + pages.length === 0 ? null : (
                                                <Hint label="Extensions">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        aria-label="Extensions"
                                                        aria-pressed={sidebarOpen}
                                                        onClick={toggleSidebar}
                                                        className={`${REACH} ${sidebarOpen ? "bg-raised text-ink" : ""}`}
                                                    >
                                                        <PanelRight className="size-4" />
                                                    </Button>
                                                </Hint>
                                            )}
                                        </>
                                    }
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
                                        queued={state.live.queued ?? NO_QUEUED}
                                        above={aboveComposer}
                                        model={model}
                                        level={active?.thinkingLevel ?? null}
                                        menuOpen={menu}
                                        onToggleMenu={toggleMenu}
                                        onSend={send}
                                        onStop={stopRun}
                                        onNewSession={newSession}
                                    />
                                </div>

                                <SessionMeta
                                    session={activeSession}
                                    sessions={sessions}
                                    status={state.live.status ?? NO_STATUS}
                                    usage={usage}
                                    openSession={go}
                                />
                            </div>

                            {openPageItem === undefined || activeSession === null ? null : (
                                <PageHost
                                    key={pageKey(openPageItem)}
                                    page={openPageItem}
                                    tabs={tabs}
                                    session={activeSession}
                                    sub={route.page?.sub}
                                    onSub={setPageSub}
                                    onBack={backPage}
                                    onClose={leavePage}
                                />
                            )}
                        </>
                    )}
                </main>

                {panel === undefined || (pageOpen && panelOpen) ? null : (
                    <PanelHost
                        panel={panel}
                        tabs={tabs}
                        session={knownSession}
                        open={panelOpen}
                        expanded={panelExpanded}
                        setExpanded={setPanelExpanded}
                        onClose={closePanel}
                        onLeft={forgetPanel}
                    />
                )}

                <Settings
                    returnFocusTo={settingsGear}
                    model={active?.model ?? ""}
                    cwd={active?.cwd ?? ""}
                    session={activeSession}
                    open={settings}
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
                settingsOpen={settings}
                settingsGear={settingsGear}
                onSettings={() => {
                    setSettings(true);
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
