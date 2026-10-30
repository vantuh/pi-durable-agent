/** The words after a count: a phone has no room for them in the status bar, so there they are only read out. */
export function CountSuffix({ children }: { children: string }) {
    return <span className="sr-only sm:not-sr-only">{children}</span>;
}
