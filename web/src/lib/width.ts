export const WIDTH_NAMES = ["comfortable", "wide", "full"] as const;

export type Width = (typeof WIDTH_NAMES)[number];

const SIZES = {
    comfortable: "46rem",
    wide: "72rem",
    full: "100%",
} as const satisfies Record<Width, string>;

export function currentWidth(): Width {
    const stored = localStorage.getItem("width");

    return WIDTH_NAMES.find((width) => width === stored) ?? "comfortable";
}

export function applyWidth(width: Width): void {
    document.documentElement.style.setProperty("--chat-width", SIZES[width]);
    localStorage.setItem("width", width);
}
