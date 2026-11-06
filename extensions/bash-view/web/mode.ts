export const MODES = ["raw", "formatted", "panels"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
    raw: "Raw",
    formatted: "Formatted",
    panels: "Panels",
};

const KEY = "bash-view-mode";

export function currentMode(): Mode {
    const stored = localStorage.getItem(KEY);

    return MODES.find((mode) => mode === stored) ?? "formatted";
}

export function applyMode(mode: Mode): void {
    localStorage.setItem(KEY, mode);
    window.dispatchEvent(new Event(KEY));
}

export function watchMode(notify: () => void): () => void {
    window.addEventListener(KEY, notify);
    window.addEventListener("storage", notify);

    return () => {
        window.removeEventListener(KEY, notify);
        window.removeEventListener("storage", notify);
    };
}
