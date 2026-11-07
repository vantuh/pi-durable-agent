import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Archive, ArrowLeft } from "lucide-react";
import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/tooltip";
import { useSessionFilters, useSessionMenu } from "@/extensions.ts";
import { fuzzyMatch } from "@/lib/fuzzy.ts";
import { isSheet, watchSheet } from "@/lib/narrow.ts";
import {
    FOLDER_PAGE,
    groupByFolder,
    LOOSE,
    openCount,
    orderedFolders,
} from "@/lib/session-folders.ts";
import { holdingRow, sidebarSessions, workingChildren } from "@/lib/session-nesting.ts";
import { newestFirst } from "@/lib/session-order.ts";
import { ago, MINUTE } from "@/lib/time.ts";
import { useShellCommand } from "@/sdk/commands.ts";
import { restoreComposerFocus } from "@/sdk/composer.ts";
import type { StatusProps } from "@/sdk/types.ts";
import { ItemBoundary } from "@/ui/item-boundary.tsx";
import { ResizeHandle } from "@/ui/resize-handle.tsx";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { folderName } from "../session-parts.tsx";
import { FolderGroup } from "./folder-group.tsx";
import { RenameDialog } from "./rename-dialog.tsx";
import { SessionRow } from "./session-row.tsx";
import { SidebarBottom } from "./sidebar-bottom.tsx";
import { SidebarHeader } from "./sidebar-header.tsx";
import { resetWidth, savedWidth, setWidth } from "./sidebar-width.ts";
import { useFolderLayout } from "./use-folder-layout.ts";
import { useFolderShown } from "./use-folder-shown.ts";
import { useMenuRunner } from "./use-menu-runner.ts";
import { useSessionActions } from "./use-session-actions.ts";
import { useSessionSearch } from "./use-session-search.ts";
import { useSidebarCollapsed } from "./use-sidebar-collapsed.ts";

type Props = {
    /** Every session, unfiltered: the rows leave out the ones started from another session in this list. */
    sessions: SessionSummary[];
    /** Null on the home page. */
    current: number | null;
    /** The open session as extensions see it, for the area under the list. */
    session: StatusProps["session"];
    onHome: () => void;
    onArchive: (id: number, archived: boolean) => Promise<void>;
    /** Out of the list for good: the row disappears, the transcript is never shown again. */
    onDelete: (id: number) => Promise<void>;
    /** An empty name returns the session to its automatic title. */
    onRename: (id: number, name: string) => Promise<void>;
    onSelect: (id: number) => void;
    onNew: () => void;
    /** A new session in a folder, opened at once. */
    onNewIn: (cwd: string) => void;
    /** Below `lg` the list is a full-screen sheet; this says whether it is showing. */
    open: boolean;
    onClose: () => void;
};

/** One list for every row without a search, so a row whose title did not change gets an equal prop. */
const NO_RANGES: [number, number][] = [];

export const Sessions = memo(function Sessions({
    sessions,
    current,
    session: activeSession,
    onHome,
    onSelect,
    onArchive,
    onDelete,
    onRename,
    onNew,
    onNewIn,
    open: sheet,
    onClose,
}: Props) {
    const { collapsed, toggleCollapsed, expand } = useSidebarCollapsed();
    const [archived, setArchived] = useState(false);
    // What each filter extension keeps, by id; a filter that goes away takes its entry with it.
    const [kept, setKept] = useState<
        Readonly<Record<string, ((session: SessionSummary) => boolean) | undefined>>
    >({});
    const asSheet = useSyncExternalStore(watchSheet, isSheet);
    const search = useSessionSearch(expand);
    const { searching, query, searchBox, stopSearch } = search;
    const list = useRef<HTMLDivElement>(null);
    const openRow = useCallback(
        (id: number): void => {
            onSelect(id);
            stopSearch();
        },
        [onSelect, stopSearch],
    );
    const menu = useSessionMenu();
    const filters = useSessionFilters();
    const setters = useMemo(() => {
        const made = new Map<
            string,
            (match: ((session: SessionSummary) => boolean) | null) => void
        >();

        for (const { id } of filters) {
            made.set(id, (match) => {
                setKept((held) => ({ ...held, [id]: match ?? undefined }));
            });
        }

        return made;
    }, [filters]);
    const { running, runMenuItem } = useMenuRunner();
    const {
        pending,
        deleting,
        setDeleting,
        renaming,
        unanchored,
        renameReturn,
        registerRow,
        startRename,
        saveName,
        stopRenaming,
        changeArchive,
        confirmDelete,
        cancelDelete,
    } = useSessionActions(sessions, current, onRename, onArchive, onDelete);
    const shell = useRef<HTMLElement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setWidth(savedWidth(), false);
    }, []);
    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    // Checked against the full list, before the folder, archive and search filters below.
    const topLevel = sidebarSessions(sessions);
    const holding = holdingRow(current, sessions);
    const { layout, setOrder, toggleFold, setLook } = useFolderLayout();
    const { countOf, setCount } = useFolderShown(FOLDER_PAGE);
    const sensors = useSensors(
        // A click stays a click; a finger must rest on the header before it drags, so a scroll stays a scroll.
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    );

    const keptBy = filters.flatMap(({ id }) => {
        const match = kept[id];

        return match === undefined ? [] : [match];
    });

    const matches = topLevel
        .toSorted(newestFirst)
        .filter((session) => session.archived === archived)
        .filter((session) => keptBy.every((match) => match(session)))
        .flatMap((session) => {
            const match = fuzzyMatch(session.title ?? "New session", query);

            return match === null ? [] : [{ session, score: match.score, ranges: match.ranges }];
        })
        // Without a query every score is equal, so the newest stays first either way.
        .toSorted(
            (left, right) => right.score - left.score || newestFirst(left.session, right.session),
        );
    const shown = matches.map((match) => match.session);
    const hits = new Map(matches.map((match) => [match.session.id, match.ranges]));
    const rangesOf = (id: number): [number, number][] => {
        const ranges = hits.get(id);

        return ranges === undefined || ranges.length === 0 ? NO_RANGES : ranges;
    };
    const filtering = query.trim() !== "";
    const focus = holding ?? current;
    const groups = groupByFolder(topLevel, shown, layout.order).map((group) => ({
        ...group,
        folded: !filtering && layout.collapsed.includes(group.cwd),
        open: openCount(group.sessions, countOf(group.cwd), focus, filtering),
    }));
    // The whole order, not the groups shown: a filter that hides a folder must not drop it from the saved order.
    const fullOrder = orderedFolders(topLevel, layout.order).map((row) => row.cwd);
    const moveTo = (cwd: string, other: string | undefined): void => {
        const from = fullOrder.indexOf(cwd);
        const to = other === undefined ? -1 : fullOrder.indexOf(other);

        if (from !== -1 && to !== -1) {
            setOrder(arrayMove(fullOrder, from, to));
        }
    };
    const dropped = ({ active, over }: DragEndEvent): void => {
        if (over !== null) {
            moveTo(String(active.id), String(over.id));
        }
    };
    // The rows in the order they are drawn, so stepping follows the filters, the folds and the pages opened.
    const visible = groups.flatMap((group) =>
        group.folded ? [] : group.sessions.slice(0, group.open),
    );
    const stepTo = (step: 1 | -1): void => {
        const at = visible.findIndex((session) => session.id === (holding ?? current));
        const index =
            at === -1
                ? step === 1
                    ? 0
                    : visible.length - 1
                : (at + step + visible.length) % visible.length;
        const target = visible[index];

        if (target !== undefined) {
            onSelect(target.id);
        }
    };

    useShellCommand("session.prev", () => {
        stepTo(-1);
    });
    useShellCommand("session.next", () => {
        stepTo(1);
    });

    const controls = (
        <>
            {filters.map((item) => {
                const setMatch = setters.get(item.id);
                const Filter = item.component;

                return setMatch === undefined ? null : (
                    <ItemBoundary
                        key={`${item.folder}:${item.id}`}
                        name={`${item.folder}:${item.id}`}
                    >
                        <Filter setMatch={setMatch} />
                    </ItemBoundary>
                );
            })}
            <Hint label={archived ? "Back to sessions" : "Show archived sessions"}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={archived ? "Back to sessions" : "Show archived sessions"}
                    aria-pressed={archived}
                    className={archived ? "bg-raised text-ink" : ""}
                    onClick={() => {
                        setArchived(!archived);
                    }}
                >
                    {archived ? <ArrowLeft className="size-4" /> : <Archive className="size-4" />}
                </Button>
            </Hint>
        </>
    );

    const aside = (
        // 37px, not a step: the collapsed rail is 6 + a 24px row + 6, plus the 1px border.
        <aside
            ref={shell}
            data-collapsed={collapsed ? "" : undefined}
            className={`group/side border-edge-soft bg-panel flex shrink-0 flex-col border-r in-[.resizing]:transition-none lg:relative lg:w-[min(var(--sidebar-w,264px),max(264px,40vw))] lg:transition-[width] lg:duration-200 lg:ease-out lg:data-[collapsed]:w-[37px] ${
                asSheet ? "min-h-0 flex-1 border-r-0" : ""
            }`}
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SidebarHeader
                    asSheet={asSheet}
                    current={current}
                    search={search}
                    controls={controls}
                    onToggleCollapsed={toggleCollapsed}
                    onHome={onHome}
                    onNew={onNew}
                    onClose={onClose}
                />

                <ScrollArea ref={list} className="min-h-0 flex-1">
                    <nav className="p-1.5">
                        {shown.length === 0 ? (
                            <Empty
                                className="px-2 py-3"
                                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `output` is a calculation's result, and this is what a filter found
                                role="status"
                            >
                                {archived
                                    ? "No archived sessions"
                                    : query.trim() === ""
                                      ? "No sessions"
                                      : "No sessions match"}
                            </Empty>
                        ) : null}
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={dropped}
                        >
                            <SortableContext
                                items={groups.map((group) => group.cwd)}
                                strategy={verticalListSortingStrategy}
                            >
                                {groups.map((group, index) => (
                                    <FolderGroup
                                        key={group.cwd}
                                        cwd={group.cwd}
                                        name={
                                            layout.folders[group.cwd]?.name ?? folderName(group.cwd)
                                        }
                                        color={layout.folders[group.cwd]?.color}
                                        sessions={group.sessions}
                                        open={group.open}
                                        folded={group.folded}
                                        searching={filtering}
                                        canMoveUp={index > 0}
                                        canMoveDown={
                                            index < groups.length - 1 &&
                                            groups[index + 1]?.cwd !== LOOSE
                                        }
                                        onToggle={toggleFold}
                                        onNew={onNewIn}
                                        onOpenCount={setCount}
                                        onLook={setLook}
                                        onMove={(cwd, by) => {
                                            moveTo(cwd, groups[index + by]?.cwd);
                                        }}
                                        renderRow={(session) => (
                                            <SessionRow
                                                key={session.id}
                                                session={session}
                                                working={workingChildren(session.id, sessions)}
                                                time={
                                                    session.activeAt === null
                                                        ? null
                                                        : ago(session.activeAt, now)
                                                }
                                                ranges={rangesOf(session.id)}
                                                current={session.id === current}
                                                holding={session.id === holding}
                                                menu={menu}
                                                running={running}
                                                pending={pending}
                                                renaming={renaming === session.id && !unanchored}
                                                registerRow={registerRow}
                                                onOpen={openRow}
                                                onRunItem={runMenuItem}
                                                onRename={startRename}
                                                onRenameSave={saveName}
                                                onRenameCancel={stopRenaming}
                                                onArchive={changeArchive}
                                                onDelete={setDeleting}
                                                deleting={deleting?.id === session.id}
                                                onConfirmDelete={confirmDelete}
                                                onCancelDelete={cancelDelete}
                                            />
                                        )}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    </nav>
                </ScrollArea>
                <SidebarBottom
                    list={list}
                    session={activeSession}
                    sessions={sessions}
                    openSession={onSelect}
                />
            </div>

            {unanchored && renaming !== null ? (
                <RenameDialog
                    id={renaming}
                    name={sessions.find((session) => session.id === renaming)?.name ?? ""}
                    pending={pending}
                    returnTo={renameReturn}
                    onSave={saveName}
                    onCancel={stopRenaming}
                />
            ) : null}

            {collapsed ? null : (
                <ResizeHandle
                    edge="right"
                    label="Resize sidebar"
                    onResize={setWidth}
                    base={savedWidth}
                    onReset={resetWidth}
                />
            )}
        </aside>
    );

    return asSheet ? (
        <Sheet
            open={sheet}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <SheetContent
                side="full"
                aria-describedby={undefined}
                // The search box closes itself on Escape; the sheet closes on the next one.
                onEscapeKeyDown={(event) => {
                    if (document.activeElement === searchBox.current && searching) {
                        event.preventDefault();
                    }
                }}
                onCloseAutoFocus={(event) => {
                    if (restoreComposerFocus("close")) {
                        event.preventDefault();
                    }
                }}
                className="border-l-0"
            >
                {aside}
            </SheetContent>
        </Sheet>
    ) : (
        aside
    );
});
