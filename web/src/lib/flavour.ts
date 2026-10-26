export const FLAVOURS = ["latte", "frappe", "macchiato", "mocha"] as const;

export type Flavour = (typeof FLAVOURS)[number];

export function currentFlavour(): Flavour {
    const stored = localStorage.getItem("flavour");

    return FLAVOURS.find((flavour) => flavour === stored) ?? "mocha";
}

export function applyFlavour(flavour: Flavour): void {
    document.documentElement.dataset["flavour"] = flavour;
    localStorage.setItem("flavour", flavour);
}
