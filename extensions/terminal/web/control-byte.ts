/** The physical key behind a letter: `code` names the position, so it survives a non-Latin layout. */
const KEY_LETTER = /^Key([A-Z])$/;

/**
 * The control byte a key press has to be sent as by hand, or null when xterm handles it. `selection` is
 * read only when it matters.
 */
export function controlByteOf(event: KeyboardEvent, selection: () => string): string | null {
    // A non-Latin layout reports an unmapped keyCode, and keyCode is the only thing xterm reads
    // Ctrl+C from: on a Cyrillic layout no interrupt ever left. `code` names the physical key,
    // the same on every layout, so the control byte is worked out from it.
    const letter = KEY_LETTER.exec(event.code)?.[1];

    if (
        event.type === "keydown" &&
        letter !== undefined &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.keyCode < 65 || event.keyCode > 90)
    ) {
        return String.fromCharCode(letter.charCodeAt(0) - 64);
    }

    // On a keyboard remapped to PC-style Cmd shortcuts no Ctrl+C reaches the page at all. Cmd+C
    // with nothing selected means the interrupt there, and only then: with a selection it is the
    // copy the rest of the app expects.
    if (
        event.type === "keydown" &&
        event.code === "KeyC" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        selection() === ""
    ) {
        return "\u0003";
    }

    return null;
}
