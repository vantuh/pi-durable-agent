/** Under `sm`: a menu has no room beside its row, so a submenu opens inside it instead. */
const QUERY = "(max-width: 639px)";

export function watchNarrow(notify: () => void): () => void {
    const query = matchMedia(QUERY);

    query.addEventListener("change", notify);

    return () => {
        query.removeEventListener("change", notify);
    };
}

export const isNarrow = (): boolean => matchMedia(QUERY).matches;
