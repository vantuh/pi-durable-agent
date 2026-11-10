/** What the person does on the page, as agent-browser's stream input messages. */

export type PageInput =
    | { type: "click"; x: number; y: number; count?: number; button?: "left" | "right" }
    | { type: "wheel"; x: number; y: number; dx: number; dy: number }
    | { type: "key"; key: string; modifiers: number }
    | { type: "text"; text: string };

/** Keys other than characters: their DOM code and Windows key code, which Chrome needs to act on them. */
const KEYS: Record<string, [string, number]> = {
    Enter: ["Enter", 13],
    Tab: ["Tab", 9],
    Backspace: ["Backspace", 8],
    Delete: ["Delete", 46],
    Escape: ["Escape", 27],
    ArrowLeft: ["ArrowLeft", 37],
    ArrowUp: ["ArrowUp", 38],
    ArrowRight: ["ArrowRight", 39],
    ArrowDown: ["ArrowDown", 40],
    Home: ["Home", 36],
    End: ["End", 35],
    PageUp: ["PageUp", 33],
    PageDown: ["PageDown", 34],
};

export function messagesOf(input: PageInput): Record<string, unknown>[] {
    if (input.type === "click") {
        const button = input.button ?? "left";
        const at = { type: "input_mouse", x: input.x, y: input.y };
        const presses = Array.from({ length: input.count ?? 1 }, (_, index) => [
            { ...at, eventType: "mousePressed", button, clickCount: index + 1 },
            { ...at, eventType: "mouseReleased", button, clickCount: index + 1 },
        ]);

        return [{ ...at, eventType: "mouseMoved" }, ...presses.flat()];
    }

    if (input.type === "wheel") {
        return [
            {
                type: "input_mouse",
                eventType: "mouseWheel",
                x: input.x,
                y: input.y,
                deltaX: input.dx,
                deltaY: input.dy,
            },
        ];
    }

    if (input.type === "text") {
        return input.text === ""
            ? []
            : [{ type: "input_keyboard", eventType: "char", text: input.text }];
    }

    const { key, modifiers } = input;
    const special = KEYS[key];

    // A character without Control, Alt or Meta types itself.
    if (special === undefined && key.length === 1 && (modifiers & 7) === 0) {
        return [{ type: "input_keyboard", eventType: "char", text: key }];
    }

    const upper = key.toUpperCase();
    const [code, keyCode] = special ?? [
        /^[a-z]$/i.test(key) ? `Key${upper}` : /^\d$/.test(key) ? `Digit${key}` : "",
        /^[a-z\d]$/i.test(key) ? upper.charCodeAt(0) : 0,
    ];

    if (keyCode === 0) {
        return [];
    }

    const base = {
        type: "input_keyboard",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        modifiers,
    };

    return [
        { ...base, eventType: "keyDown", ...(key === "Enter" ? { text: "\r" } : {}) },
        { ...base, eventType: "keyUp" },
    ];
}
