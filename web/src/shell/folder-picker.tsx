import { ArrowUp, Folder, House, Laptop, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import type { NewSessionCollected } from "@/sdk/types.ts";

import { type FolderNewSessionItem, useNewSessionItems } from "../extensions.ts";
import {
    type FolderPage,
    getFavourites,
    listFolders,
    setFavourites as saveFavourites,
} from "../lib/api.ts";

type Props = {
    start: string;
    recent: string[];
    onClose: () => void;
    onOpen: (path: string) => void;
};

function crumbs(path: string): { name: string; path: string }[] {
    const parts = path.split("/").filter((part) => part !== "");
    const out: { name: string; path: string }[] = [];

    let so_far = "";

    for (const part of parts) {
        so_far += `/${part}`;
        out.push({ name: part, path: so_far });
    }

    return out;
}

export function FolderPicker({ start, recent, onClose, onOpen }: Props) {
    const [page, setPage] = useState<FolderPage | undefined>(undefined);
    const [path, setPath] = useState(start);
    const [hidden, setHidden] = useState(false);
    const [error, setError] = useState(false);
    /** What each extension's option in the footer collected; null for the folder as picked. */
    const [collected, setCollected] = useState<Record<string, NewSessionCollected | null>>({});
    /** What an option's `place` threw last time: the option, and what it said. */
    const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
    const [opening, setOpening] = useState(false);
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
    const [favourites, setFavourites] = useState<string[]>([]);
    /** The stored list is here: a star pressed before it would save one folder over all of them. */
    const [favouritesLoaded, setFavouritesLoaded] = useState(false);
    const openRef = useRef<HTMLButtonElement>(null);
    const recents = [...new Set(recent)].filter((folder) => !favourites.includes(folder));

    const toggle = (folder: string): void => {
        const next = favourites.includes(folder)
            ? favourites.filter((entry) => entry !== folder)
            : [...favourites, folder];

        setFavourites(next);
        void saveFavourites(next);
    };

    useEffect(() => {
        void (async () => {
            const stored = await getFavourites().catch(() => []);

            setFavourites(stored);
            setFavouritesLoaded(true);
        })();
    }, []);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const next = await listFolders(path, hidden);

            if (alive) {
                setPage(next);
                setError(next === undefined);
            }
        })();

        return () => {
            alive = false;
        };
    }, [path, hidden]);

    const go = (next: string | null | undefined): void => {
        if (typeof next === "string" && next !== "") {
            setPath(next);
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
                        onClick={() => {
                            go(folder);
                        }}
                    />
                ))}
            </>
        );

    const trail = crumbs(page?.path ?? path);
    const picked = page?.path ?? path;

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
                className="sm:max-w-3xl"
                onAnimationEnd={(event) => {
                    if (!open && event.target === event.currentTarget) {
                        after.current?.();
                    }
                }}
                onOpenAutoFocus={(event) => {
                    // Radix focuses the first tabbable (the Up button) unless the default is cancelled.
                    event.preventDefault();
                    openRef.current?.focus();
                }}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.defaultPrevented) {
                        return;
                    }

                    if (event.target instanceof HTMLElement && event.target.closest("button")) {
                        return;
                    }

                    void startIn(picked);
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

                    <div className="rounded-control bg-sunken text-meta flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5 font-mono">
                        {trail.map((crumb, at) => (
                            <span
                                key={crumb.path}
                                className="flex shrink-0 items-center gap-1 whitespace-nowrap"
                            >
                                {at === 0 ? null : <span className="text-faint">›</span>}
                                <button
                                    type="button"
                                    onClick={() => {
                                        go(crumb.path);
                                    }}
                                    className={
                                        at === trail.length - 1
                                            ? "text-ink font-medium"
                                            : "text-muted hover:text-ink"
                                    }
                                >
                                    {crumb.name}
                                </button>
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 gap-2 px-4">
                    <nav className="flex min-h-0 w-44 shrink-0 flex-col gap-0.5 overflow-y-auto">
                        <Row
                            icon={<House className="size-4" />}
                            label="Home"
                            onClick={() => {
                                go(page?.home);
                            }}
                        />
                        <Row
                            icon={<Laptop className="size-4" />}
                            label="Computer"
                            onClick={() => {
                                go("/");
                            }}
                        />
                        {section("Favourites", favourites)}
                        {section("Recent", recents)}
                    </nav>

                    <ScrollArea className="rounded-control border-edge-soft min-h-0 flex-1 border">
                        <div className="p-1">
                            {error ? (
                                <p className="text-danger text-meta p-2">
                                    Cannot read that folder.
                                </p>
                            ) : (
                                (page?.dirs ?? []).map((dir) => (
                                    <button
                                        key={dir.path}
                                        type="button"
                                        onDoubleClick={() => {
                                            go(dir.path);
                                        }}
                                        onClick={() => {
                                            go(dir.path);
                                        }}
                                        className="rounded-control text-ink hover:bg-raised text-interface flex w-full items-center gap-2 px-2 py-1.5 text-left"
                                    >
                                        <Folder className="text-info size-4 shrink-0" />
                                        <span className="truncate">{dir.name}</span>
                                    </button>
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
                            cwd={page?.path ?? null}
                            onUse={remember}
                            refused={refused(option)}
                        />
                    ))}

                    <div className="flex items-center justify-between gap-3">
                        <label
                            htmlFor="folder-picker-show-hidden"
                            className="text-muted text-meta flex items-center gap-2"
                        >
                            <Checkbox
                                id="folder-picker-show-hidden"
                                checked={hidden}
                                onCheckedChange={(checked) => {
                                    setHidden(checked === true);
                                }}
                            />
                            Show hidden
                        </label>

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
                                ref={openRef}
                                disabled={held}
                                onClick={() => {
                                    setOpening(true);
                                    setProblem(null);
                                    void startIn(picked);
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

function Row({
    icon,
    label,
    active,
    onIcon,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    onIcon?: () => void;
    onClick: () => void;
}) {
    return (
        <div
            className={`rounded-control text-interface flex items-center gap-2 px-2 py-1.5 ${
                active === true ? "bg-raised text-ink" : "text-muted hover:bg-raised"
            }`}
        >
            {onIcon === undefined ? (
                icon
            ) : (
                <Hint label="Favourite">
                    <Button
                        variant="ghost"
                        aria-label="Favourite"
                        onClick={onIcon}
                        className="size-4 shrink-0 p-0 hover:bg-transparent"
                    >
                        {icon}
                    </Button>
                </Hint>
            )}
            <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
                <span className="block truncate">{label}</span>
            </button>
        </div>
    );
}

/** One extension's option in the footer, given a `use` that holds still while the dialog renders. */
function Option({
    option,
    cwd,
    refused,
    onUse,
}: {
    option: FolderNewSessionItem;
    cwd: string | null;
    refused: string | null;
    onUse: (id: string, collected: NewSessionCollected | null) => void;
}) {
    const { id, component: Component } = option;
    const use = useCallback(
        (collected: NewSessionCollected | null) => {
            onUse(id, collected);
        },
        [id, onUse],
    );

    return <Component cwd={cwd} use={use} refused={refused} />;
}
