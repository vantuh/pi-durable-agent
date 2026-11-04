/** Under `sm`: a menu has no room beside its row, so a submenu opens inside it instead. */
const NARROW = "(max-width: 639px)";
/** Under `lg`: the session list is a sheet over the app; from `lg` up it is a column beside it. */
const SHEET = "(max-width: 1023px)";

const watch =
    (query: string) =>
    (notify: () => void): (() => void) => {
        const list = matchMedia(query);

        list.addEventListener("change", notify);

        return () => {
            list.removeEventListener("change", notify);
        };
    };

export const watchNarrow = watch(NARROW);
export const isNarrow = (): boolean => matchMedia(NARROW).matches;
export const watchSheet = watch(SHEET);
export const isSheet = (): boolean => matchMedia(SHEET).matches;
