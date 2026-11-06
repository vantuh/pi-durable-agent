export const WIDTH_KEY = "sidebarWidth";
export const USUAL_WIDTH = 264;
const MIN_WIDTH = 204;
const MAX_WIDTH = 464;

export function savedWidth(): number {
    const width = Number(localStorage.getItem(WIDTH_KEY));

    return width > 0 ? width : USUAL_WIDTH;
}

/** The stylesheet caps it at 40% of the screen as well, so the conversation keeps room. */
export function setWidth(wanted: number, save: boolean): number {
    const max = Math.min(MAX_WIDTH, Math.max(USUAL_WIDTH, innerWidth * 0.4));
    const width = Math.round(Math.min(max, Math.max(MIN_WIDTH, wanted)));

    document.documentElement.style.setProperty("--sidebar-w", `${String(width)}px`);

    if (save) {
        localStorage.setItem(WIDTH_KEY, String(width));
    }

    return width;
}

export function resetWidth(): void {
    localStorage.removeItem(WIDTH_KEY);
    setWidth(USUAL_WIDTH, false);
}
