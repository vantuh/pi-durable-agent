import { PanelRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, REACH } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

import type { ClientQueued, ClientStatus } from "../../shared/protocol.ts";
import { AboveComposerItems } from "./composer/above-items.tsx";
import { Composer } from "./composer/composer.tsx";
import { SessionMeta } from "./composer/meta.tsx";
import { ModelMenu } from "./composer/model-menu.tsx";
import { useModelMenu } from "./composer/use-model-menu.ts";
import { type Health, getHealth } from "./lib/api.ts";
import { useConversation } from "./lib/conversation.ts";
import { noticeTarget } from "./lib/notice.ts";
import { useRoute } from "./lib/route.ts";
import { useSeen } from "./lib/seen.ts";
import { useSessionList } from "./lib/session-list.ts";
import { useShellCommand } from "./sdk/commands.ts";
import { useEdgeSwipe } from "./shell/edge-swipe.ts";
import { FolderPicker } from "./shell/folder-picker/folder-picker.tsx";
import { HeaderItems } from "./shell/header-items.tsx";
import { Home } from "./shell/home.tsx";
import { PageHost, pageKey } from "./shell/panels/pages.tsx";
import { PanelHost } from "./shell/panels/panels.tsx";
import { ExtensionTabs } from "./shell/panels/tabs.tsx";
import { usePanelCoordination } from "./shell/panels/use-panel-coordination.ts";
import { showSessionAlert } from "./shell/session-alert.tsx";
import { Sessions } from "./shell/sessions/sessions.tsx";
import { Settings } from "./shell/settings/settings.tsx";
import { StatusBar } from "./shell/status-bar.tsx";
import { useSessionHandlers } from "./shell/use-session-handlers.ts";
import { useWindowFocus } from "./shell/use-window-focus.ts";
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
    const navigation = useRoute();
    const { route, go, setPageSub, backPage } = navigation;
    const current = route.session;
    const [picker, setPicker] = useState(false);
    const [sheet, setSheet] = useState(false);
    const [settings, setSettings] = useState(false);
    const settingsGear = useRef<HTMLButtonElement>(null);
    const {
        panels,
        tabPages,
        panel,
        panelShown,
        panelOpen,
        panelExpanded,
        pageOpen,
        openPageItem,
        sidebarOpen,
        closePanel,
        setPanelExpanded,
        forgetPanel,
        leavePage,
        selectPanel,
        selectPage,
        openFromHeader,
        toggleSidebar,
    } = usePanelCoordination(navigation);
    useWindowFocus();

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

    const active = sessions.find((session) => session.id === current);

    // The conversation on screen answers with its own state: until its hello arrives, what is shown is not an empty
    // session, it is one that has not been read yet.
    const loading = current !== null && state.session !== current;

    // The tab, and an installed window, carry the session's name; the list streams a rename at once.
    useEffect(() => {
        document.title = active?.title ? `Pi · ${active.title}` : "Pi";
    }, [active?.title]);

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

    const tabs = (
        <ExtensionTabs
            panels={panels}
            pages={tabPages}
            session={activeSession}
            panel={pageOpen ? null : panelShown}
            page={openPageItem === undefined ? null : pageKey(openPageItem)}
            onPanel={selectPanel}
            onPage={selectPage}
        />
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
    const { reload, select, home, archive, remove, rename, openSession } = useSessionHandlers({
        current,
        go,
        setSessions,
        closeSheet,
    });
    const { menu, toggleMenu, menuProps } = useModelMenu(current, reload);

    // The screen around the reply keeps its props across a frame, so none of it renders again for one. Every fresh
    // function or element below would defeat that memo.
    const aboveComposer = useMemo(
        () => <AboveComposerItems session={activeSession} openSession={go} />,
        [activeSession, go],
    );
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

    useShellCommand("session.new.pick", askFolder);

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
                                            <HeaderItems
                                                session={activeSession}
                                                openPage={openFromHeader}
                                            />
                                            {panels.length + tabPages.length === 0 ? null : (
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
                                            {...menuProps}
                                            current={active?.model ?? null}
                                            level={active?.thinkingLevel ?? null}
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
                    // A session in a worktree offers its repository's folder, as the sidebar shows it.
                    start={(active ?? last)?.under ?? folder ?? health?.home ?? "/"}
                    recent={sessions
                        .map((session) => session.under ?? session.cwd)
                        .filter((cwd) => cwd !== null)}
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
