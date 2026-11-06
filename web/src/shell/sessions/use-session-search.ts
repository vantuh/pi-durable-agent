import { useCallback, useEffect, useRef, useState } from "react";

import { useShellCommand } from "@/sdk/commands.ts";

export function useSessionSearch(expand: () => void) {
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const searchBox = useRef<HTMLInputElement>(null);
    // Where a hotkey found the focus, so Escape gives it back there instead of to the search button.
    const searchFrom = useRef<HTMLElement | null>(null);

    useShellCommand("session.search", () => {
        if (document.activeElement !== searchBox.current) {
            searchFrom.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        expand();
        setSearching(true);
        searchBox.current?.focus();
    });
    const searchTrigger = useRef<HTMLButtonElement>(null);
    const stopSearch = useCallback((): void => {
        setSearching(false);
        setQuery("");
        // The box is only hidden, not unmounted, so it would keep the keys pressed after Escape.
        const back = searchFrom.current?.isConnected ? searchFrom.current : searchTrigger.current;

        searchFrom.current = null;
        back?.focus();
    }, []);

    useEffect(() => {
        if (searching) {
            searchBox.current?.focus();
        }
    }, [searching]);

    const startSearch = (): void => {
        setSearching(true);
    };

    return { searching, query, setQuery, searchBox, searchTrigger, startSearch, stopSearch };
}
