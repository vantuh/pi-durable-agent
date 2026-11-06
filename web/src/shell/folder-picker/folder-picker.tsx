import { ArrowUp, Folder, House, Laptop, Star } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Item } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { type FolderNewSessionItem, useNewSessionItems } from "@/extensions.ts";
import { restoreComposerFocus } from "@/sdk/composer.ts";
import type { NewSessionCollected } from "@/sdk/types.ts";

import { crumbs, folderAt, nextRow, parentOf, rowFor, rowsOf } from "./folder-picker-keys.ts";
import { Option } from "./option.tsx";
import { Row } from "./row.tsx";
import { useFavourites } from "./use-favourites.ts";
import { useFolderListing } from "./use-folder-listing.ts";
import { useOffered } from "./use-offered.ts";

type Props = {
    start: string;
    recent: string[];
    onClose: () => void;
    onOpen: (path: string) => void;
};

/** A field keeps its own arrow keys: moving the caret out of one would swallow an edit. */
const FIELD = "input, textarea, select, [contenteditable='true']";

export function FolderPicker({ start, recent, onClose, onOpen }: Props) {
    const { favourites, favouritesLoaded, toggle } = useFavourites();
    const { page, path, about, cameFrom, fresh, hidden, setHidden, error, move } =
        useFolderListing(start);
    /** What each extension's option in the footer collected; null for the folder as picked. */
    const [collected, setCollected] = useState<Record<string, NewSessionCollected | null>>({});
    /** What an option's `place` threw last time: the option, and what it said. */
    const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
    const [opening, setOpening] = useState(false);
    /** The row the caret picked: Enter, Open and each option start there, and it stays marked. */
    const [selected, setSelected] = useState<string | undefined>(undefined);
    /** The parent drops this dialog the moment it is told to close; it stays until its exit is over. */
    const [open, setOpen] = useState(true);
    const after = useRef<(() => void) | null>(null);

    const leave = (then: () => void): void => {
        after.current = then;
        setOpen(false);
    };
    /** What an option collected, held still while the dialog renders; a change takes its last failure away. */
    const remember = useCallback((id: string, value: NewSessionCollected | null): void => {
        setProblem(null);
        setCollected((all) => ({ ...all, [id]: value }));
    }, []);
    const options = useNewSessionItems();
    /** The two lists: the keys move between their rows, and Tab crosses from one to the other. */
    const left = useRef<HTMLElement | null>(null);
    const right = useRef<HTMLDivElement | null>(null);
    /** The left row the caret last stood on, so Shift+Tab comes back to it. */
    const leftAt = useRef<HTMLElement | null>(null);
    /** Opening the picker or another folder puts the caret on its first row. */
    const returnFocus = useRef(true);
    /** A `place` is running: a second Enter would ask every option twice. */
    const starting = useRef(false);
    const recents = [...new Set(recent)].filter((folder) => !favourites.includes(folder));
    // One key for everything the lists hold, so the options are asked when a list changes and not on
    // every render: a folder that is a worktree keeps its place in the stored favourites. `recent` is a
    // new array at each render of the app, and a NUL is the one byte a folder's name cannot hold.
    const lists = [
        ...new Set([...favourites, ...recent, ...(page?.dirs ?? []).map((dir) => dir.path)]),
    ].join("\0");

    // A folder change puts the caret where it belongs: on the folder a move up came back from; on the row
    // of the folder the picker opened on, so Enter starts the session there; on the folder's first row
    // after a move; on the pane with no row.
    useEffect(() => {
        if (!returnFocus.current || !fresh) {
            return;
        }

        returnFocus.current = false;

        const row = rowFor(rowsOf(right.current), cameFrom ?? about);

        (row ?? right.current)?.focus();
    }, [fresh, about, cameFrom]);

    const offered = useOffered(lists, options);

    /** Opens `next` in the pane, with no row picked: the rows on screen are about to be its own. */
    const go = (next: string | null | undefined): void => {
        if (typeof next === "string" && next !== "") {
            move(next);
            setSelected(undefined);
        }
    };

    const section = (title: string, folders: string[]) =>
        folders.length === 0 ? null : (
            <>
                <div className="text-faint text-meta px-2 pt-2 pb-1">{title}</div>
                {folders.map((folder) => (
                    <Row
                        key={folder}
                        icon={
                            <Star
                                className={`size-4 ${favourites.includes(folder) ? "text-warn fill-current" : ""}`}
                            />
                        }
                        {...(favouritesLoaded
                            ? {
                                  onIcon: () => {
                                      toggle(folder);
                                  },
                              }
                            : {})}
                        label={folder.split("/").pop() ?? folder}
                        active={folder === page?.path}
                        selected={folder === kept}
                        folder={folder}
                        onClick={() => {
                            go(folder);
                        }}
                    />
                ))}
            </>
        );

    const trail = crumbs(page?.path ?? path);
    const picked = page?.path ?? path;
    /**
     * The subfolders the pane draws: those an option leaves on offer, and the folder the picker opened
     * on even when its parent's list leaves it out — hidden, or kept out — since Enter means it.
     */
    const subs = (page?.dirs ?? []).filter((dir) => dir.path === about || offered(dir.path));

    if (about !== null && parentOf(about) === picked && !subs.some((dir) => dir.path === about)) {
        subs.push({ name: about.slice(about.lastIndexOf("/") + 1), path: about });
        subs.sort((one, other) => one.name.localeCompare(other.name));
    }

    // What Enter may pick: the rows on screen, Home and Computer, and the two stored lists.
    const shown = [
        ...(page === undefined ? [] : [page.home, "/"]),
        ...subs.map((dir) => dir.path),
        ...favourites.filter(offered),
        ...recents.filter(offered),
    ];
    /** The row the caret picked, while the lists still offer it: one they dropped is no target. */
    const kept = shown.includes(selected ?? "") ? selected : undefined;
    /** Where a session starts: the row picked, else the folder on screen, else the one still to come. */
    const here = fresh ? (kept ?? picked) : (about ?? path);

    /** What this option says about going ahead: its own `blocked`, or what its `place` threw. */
    const refused = (option: FolderNewSessionItem): string | null =>
        problem?.id === option.id
            ? problem.message
            : (option.blocked?.(collected[option.id] ?? null) ?? null);

    /** Whether the option's own check says no; a failure is said, not held, so Open stays a retry. */
    const holds = (option: FolderNewSessionItem): boolean =>
        (option.blocked?.(collected[option.id] ?? null) ?? null) !== null;

    const held = options.some(holds) || opening;

    /** Where the session starts: the folder as picked, through each option that collected something. */
    const startIn = async (folder: string): Promise<void> => {
        let where = folder;

        try {
            for (const option of options) {
                const mine = collected[option.id] ?? null;

                if (mine === null) {
                    continue;
                }

                try {
                    where = await option.place(where, mine);
                } catch (failure) {
                    starting.current = false;
                    setProblem({
                        id: option.id,
                        message:
                            failure instanceof Error
                                ? failure.message
                                : "The session could not start.",
                    });

                    return;
                }
            }
        } finally {
            setOpening(false);
        }

        leave(() => {
            onOpen(where);
        });
    };

    /** A new session in `folder`, by key or by Open: the same checks stand in its way. */
    const openIn = (folder: string): void => {
        if (held || starting.current || !open) {
            return;
        }

        starting.current = true;
        setOpening(true);
        setProblem(null);
        void startIn(folder);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    leave(onClose);
                }
            }}
        >
            <DialogContent
                aria-describedby={undefined}
                className="sm:h-[min(44rem,88dvh)] sm:max-w-3xl"
                onAnimationEnd={(event) => {
                    if (!open && event.target === event.currentTarget) {
                        after.current?.();
                    }
                }}
                onOpenAutoFocus={(event) => {
                    // Radix focuses the first tabbable (the Up button) unless the default is cancelled.
                    event.preventDefault();
                    // The current folder's row takes focus when its parent loads.
                    right.current?.focus();
                }}
                onCloseAutoFocus={(event) => {
                    if (restoreComposerFocus("close")) {
                        event.preventDefault();
                    }
                }}
                onFocus={(event) => {
                    const target = event.target instanceof HTMLElement ? event.target : null;

                    if (target !== null && left.current?.contains(target) === true) {
                        leftAt.current = target;
                    }

                    // The row the caret lands on is the selection, by key or by pointer alike.
                    const folder = folderAt(target);

                    if (folder !== undefined) {
                        setSelected(folder);
                    }
                }}
                onKeyDown={(event) => {
                    // A key a field or an option took is theirs; a folder being read answers none: its
                    // rows still name the folder before it.
                    if (event.nativeEvent.isComposing || event.defaultPrevented || !fresh) {
                        return;
                    }

                    const target = event.target instanceof HTMLElement ? event.target : null;
                    const inLeft = target !== null && left.current?.contains(target) === true;
                    const inRight = target !== null && right.current?.contains(target) === true;

                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        // A field keeps its own arrows: moving the caret out of one would drop an edit.
                        if (target !== null && target.closest(FIELD) !== null) {
                            return;
                        }

                        const row = nextRow(
                            rowsOf(inLeft ? left.current : right.current),
                            target,
                            event.key === "ArrowDown" ? 1 : -1,
                        );

                        if (row !== undefined) {
                            event.preventDefault();
                            row.focus();
                        }

                        return;
                    }

                    // Tab crosses from the left list to the right one and comes back; elsewhere it is
                    // the browser's, so the header and the footer stay in reach.
                    if (event.key === "Tab") {
                        const back =
                            inLeft && !event.shiftKey
                                ? (rowsOf(right.current)[0] ?? right.current ?? undefined)
                                : inRight && event.shiftKey
                                  ? leftAt.current?.isConnected === true
                                      ? leftAt.current
                                      : (rowsOf(left.current)[0] ?? left.current ?? undefined)
                                  : undefined;

                        if (back !== undefined) {
                            event.preventDefault();
                            back.focus();
                        }

                        return;
                    }

                    if (event.key === "ArrowRight" && inRight) {
                        const folder = folderAt(target);

                        if (folder !== undefined) {
                            event.preventDefault();
                            returnFocus.current = true;
                            go(folder);
                        }

                        return;
                    }

                    if (
                        event.key === "ArrowLeft" &&
                        inRight &&
                        page !== undefined &&
                        page.parent !== null
                    ) {
                        event.preventDefault();
                        returnFocus.current = true;
                        go(page.parent);

                        return;
                    }

                    if (event.key !== "Enter") {
                        return;
                    }

                    // A control keeps Enter: it means its own press, not a new session.
                    if (
                        folderAt(target) === undefined &&
                        target !== null &&
                        target.closest("button") !== null
                    ) {
                        return;
                    }

                    event.preventDefault();
                    openIn(here);
                }}
            >
                <DialogHeader className="px-4 py-3 pr-10">
                    <DialogTitle>New session: pick a folder</DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-2 px-4 py-3">
                    <Hint label="Up">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Up"
                            onClick={() => {
                                go(page?.parent);
                            }}
                            className="bg-raised text-ink size-9"
                        >
                            <ArrowUp className="size-4" />
                        </Button>
                    </Hint>

                    <Breadcrumb className="bg-sunken text-meta flex min-w-0 flex-1 items-center overflow-x-auto px-2 py-1.5 font-mono">
                        <BreadcrumbList>
                            {trail.map((crumb, at) => (
                                <Fragment key={crumb.path}>
                                    {at === 0 ? null : <BreadcrumbSeparator />}
                                    <BreadcrumbItem>
                                        {at === trail.length - 1 ? (
                                            <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                                        ) : (
                                            <BreadcrumbLink asChild>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        go(crumb.path);
                                                    }}
                                                >
                                                    {crumb.name}
                                                </button>
                                            </BreadcrumbLink>
                                        )}
                                    </BreadcrumbItem>
                                </Fragment>
                            ))}
                        </BreadcrumbList>
                    </Breadcrumb>
                </div>

                <div className="flex min-h-0 flex-1 gap-2 px-4">
                    <ScrollArea className="w-44 shrink-0">
                        <nav
                            ref={left}
                            tabIndex={-1}
                            className="focus-visible:ring-accent flex flex-col gap-0.5 pr-1 outline-none focus-visible:ring-2"
                        >
                            <Row
                                icon={<House className="size-4" />}
                                label="Home"
                                folder={page?.home}
                                selected={kept === page?.home}
                                onClick={() => {
                                    go(page?.home);
                                }}
                            />
                            <Row
                                icon={<Laptop className="size-4" />}
                                label="Computer"
                                folder="/"
                                selected={kept === "/"}
                                onClick={() => {
                                    go("/");
                                }}
                            />
                            {section("Favourites", favourites.filter(offered))}
                            {section("Recent", recents.filter(offered))}
                        </nav>
                    </ScrollArea>

                    <ScrollArea className="border-edge-soft min-h-0 flex-1 border">
                        <div
                            ref={right}
                            // Focused by the keys alone: the pane keeps the caret when it holds no row.
                            tabIndex={-1}
                            className="focus-visible:ring-accent p-1 outline-none focus-visible:ring-2"
                        >
                            {error ? (
                                <Alert>Cannot read that folder.</Alert>
                            ) : (
                                subs.map((dir) => (
                                    <Item
                                        key={dir.path}
                                        asChild
                                        size="sm"
                                        className={`text-interface w-full text-left ${
                                            kept === dir.path
                                                ? "bg-raised text-ink"
                                                : "text-ink hover:bg-raised"
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            data-folder={dir.path}
                                            aria-current={kept === dir.path ? "true" : undefined}
                                            onDoubleClick={() => {
                                                go(dir.path);
                                            }}
                                            onClick={() => {
                                                go(dir.path);
                                            }}
                                        >
                                            <Folder className="text-info size-4 shrink-0" />
                                            <span className="truncate">{dir.name}</span>
                                        </button>
                                    </Item>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <footer className="border-edge-soft mt-3 flex shrink-0 flex-col gap-2 border-t px-4 py-3">
                    {options.map((option) => (
                        <Option
                            key={`${option.folder}/${option.id}`}
                            option={option}
                            cwd={page === undefined ? null : here}
                            onUse={remember}
                            refused={refused(option)}
                        />
                    ))}

                    <div className="flex items-center justify-between gap-3">
                        <Field orientation="horizontal">
                            <Checkbox
                                id="folder-picker-show-hidden"
                                checked={hidden}
                                onCheckedChange={(checked) => {
                                    setHidden(checked === true);
                                }}
                            />
                            <Label htmlFor="folder-picker-show-hidden">Show hidden</Label>
                        </Field>

                        <div className="flex shrink-0 items-center gap-2">
                            <Button
                                variant="ghost"
                                className="bg-raised text-ink"
                                onClick={() => {
                                    leave(onClose);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                disabled={held}
                                onClick={() => {
                                    openIn(here);
                                }}
                            >
                                Open
                            </Button>
                        </div>
                    </div>
                </footer>
            </DialogContent>
        </Dialog>
    );
}
