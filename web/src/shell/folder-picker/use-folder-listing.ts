import { useEffect, useState } from "react";

import { type FolderPage, listFolders } from "@/lib/api.ts";

import { bareFolder, parentOf } from "./folder-picker-keys.ts";

/** The folder on screen and its list, read from the server; `move` goes to another folder. */
export function useFolderListing(start: string) {
    const [page, setPage] = useState<FolderPage | undefined>(undefined);
    /** The path `page` was read for: until they match, the rows on screen belong to the folder before. */
    const [listed, setListed] = useState<string | null>(null);
    /** The folder the picker opened on: its own row is the caret's home, until a move leaves it. */
    const [about, setAbout] = useState<string | null>(() => bareFolder(start));
    const [path, setPath] = useState(() => parentOf(start) ?? start);
    /** The folder a move back up left behind: its row is where the caret lands, not the first one. */
    const [cameFrom, setCameFrom] = useState<string | null>(null);
    /** The rows on screen answer for `path`; before they do, they name the folder before it. */
    const fresh = listed === path;
    const [hidden, setHidden] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const next = await listFolders(path, hidden);

            if (!alive) {
                return;
            }

            // A parent that cannot be read is no place to pick from: browse the folder it opened on.
            if (next === undefined && about !== null && path !== about) {
                setPath(about);

                return;
            }

            setPage(next);
            setListed(path);
            setError(next === undefined);
        })();

        return () => {
            alive = false;
        };
    }, [path, hidden, about]);

    /** Opens `next` in the pane. */
    const move = (next: string): void => {
        // Moving up leaves the folder behind: its row in the parent is where the caret belongs.
        const here = page?.path ?? path;

        setCameFrom(parentOf(here) === bareFolder(next) ? here : null);
        setPath(next);
        // The picker has moved: the folder it opened on is no longer the caret's home.
        setAbout(null);
    };

    return { page, path, about, cameFrom, fresh, hidden, setHidden, error, move };
}
