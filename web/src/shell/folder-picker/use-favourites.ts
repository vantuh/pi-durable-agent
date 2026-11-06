import { useEffect, useState } from "react";

import { getFavourites, setFavourites as saveFavourites } from "@/lib/api.ts";

export function useFavourites() {
    const [favourites, setFavourites] = useState<string[]>([]);
    /** The stored list is here: a star pressed before it would save one folder over all of them. */
    const [favouritesLoaded, setFavouritesLoaded] = useState(false);

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

    return { favourites, favouritesLoaded, toggle };
}
