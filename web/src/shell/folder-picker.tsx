import { ArrowUp, Folder, House, Laptop, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                aria-describedby={undefined}
                className="sm:max-w-3xl"
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

                    onOpen(page?.path ?? path);
                }}
            >
                <DialogHeader className="px-4 py-3 pr-10">
                    <DialogTitle>New session: pick a folder</DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-2 px-4 py-3">
                    <button
                        type="button"
                        onClick={() => {
                            go(page?.parent);
                        }}
                        title="Up"
                        className="rounded-control bg-raised text-ink flex size-9 items-center justify-center"
                    >
                        <ArrowUp className="size-4" />
                    </button>

                    <div className="rounded-control bg-sunken text-meta flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5 font-mono">
                        {trail.map((crumb, at) => (
                            <span key={crumb.path} className="flex items-center gap-1">
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
                    <nav className="flex w-44 shrink-0 flex-col gap-0.5">
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

                    <ScrollArea className="rounded-control border-edge-soft min-h-[16rem] flex-1 border">
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

                <footer className="border-edge-soft mt-3 flex items-center justify-between gap-3 border-t px-4 py-3">
                    <label className="text-muted text-meta flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={hidden}
                            onChange={(event) => {
                                setHidden(event.target.checked);
                            }}
                        />
                        Show hidden
                    </label>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-control bg-raised text-ink text-interface px-3 py-1.5"
                        >
                            Cancel
                        </button>
                        <button
                            ref={openRef}
                            type="button"
                            onClick={() => {
                                onOpen(page?.path ?? path);
                            }}
                            className="rounded-control bg-accent text-on-accent text-interface px-3 py-1.5 font-medium"
                        >
                            Open
                        </button>
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
                <button type="button" onClick={onIcon} title="Favourite" className="hover:text-ink">
                    {icon}
                </button>
            )}
            <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
                <span className="block truncate">{label}</span>
            </button>
        </div>
    );
}
