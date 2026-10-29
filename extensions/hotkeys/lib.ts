/** Key bindings, the keymap and the prefix state machine. Browser-safe: no imports. */

/** The first two are the shell's own (`ShellCommand`); `web.tsx` fails to compile when they drift apart. */
export const COMMANDS = ["session.new", "folder.pick", "session.prev", "session.next"] as const;

export type Command = (typeof COMMANDS)[number];

/** Binding strings such as `ctrl+a`, `prefix+c` or `shift+left`; a command may have several. */
export type Keymap = { prefix: string; keys: Record<Command, string[]> };

export const DEFAULT_KEYMAP: Keymap = {
    prefix: "ctrl+a",
    keys: {
        "session.new": ["prefix+c"],
        "folder.pick": ["prefix+s"],
        "session.prev": ["shift+left", "prefix+p"],
        "session.next": ["shift+right", "prefix+n"],
    },
};

/** `code` is a `KeyboardEvent.code`: keys bind by position, so a binding holds on any layout. */
export type Binding = {
    prefixed: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    code: string;
};

export type KeyEvent = {
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    repeat: boolean;
};

const NAMED = new Map([
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
    ["up", "ArrowUp"],
    ["down", "ArrowDown"],
    ["escape", "Escape"],
    ["enter", "Enter"],
    ["tab", "Tab"],
    ["space", "Space"],
    [",", "Comma"],
    [".", "Period"],
    ["-", "Minus"],
    ["/", "Slash"],
    ["[", "BracketLeft"],
    ["]", "BracketRight"],
]);

function codeOf(key: string): string | null {
    if (/^[a-z]$/.test(key)) {
        return `Key${key.toUpperCase()}`;
    }

    if (/^[0-9]$/.test(key)) {
        return `Digit${key}`;
    }

    return NAMED.get(key) ?? null;
}

const NON_PRINTING = /^(Arrow|Escape|Enter|Tab)/;

/**
 * Null when the text is not a binding of that role. A prefix needs ctrl, alt or meta; a key bound
 * without the prefix must not be one that types a character, unless it carries one of those.
 */
export function parseBinding(text: string, role: "prefix" | "key" = "key"): Binding | null {
    const parts = text.toLowerCase().split("+");
    const code = codeOf(parts.pop()?.trim() ?? "");
    const binding = { prefixed: false, ctrl: false, alt: false, shift: false, meta: false };

    if (code === null) {
        return null;
    }

    for (const part of parts.map((each) => each.trim())) {
        if (part === "prefix") {
            binding.prefixed = true;
        } else if (part === "ctrl" || part === "alt" || part === "shift" || part === "meta") {
            binding[part] = true;
        } else {
            return null;
        }
    }

    const modified = binding.ctrl || binding.alt || binding.meta;
    const allowed =
        role === "prefix"
            ? !binding.prefixed && modified
            : binding.prefixed || modified || NON_PRINTING.test(code);

    return allowed ? { ...binding, code } : null;
}

function bindings(value: unknown): string[] | null {
    const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;

    if (list === null) {
        return null;
    }

    const valid = list.filter(
        (text): text is string => typeof text === "string" && parseBinding(text) !== null,
    );

    // An empty list unbinds the command; a list with nothing usable in it is a mistake, so the default stays.
    return valid.length === 0 && list.length > 0 ? null : valid;
}

/** The defaults, with each valid entry of `config` laid over them. The one check a keymap goes through. */
export function mergeKeymap(config: unknown): Keymap {
    const isObject = typeof config === "object" && config !== null;
    const prefix: unknown = isObject ? Reflect.get(config, "prefix") : undefined;
    const keys: unknown = isObject ? Reflect.get(config, "keys") : undefined;
    const merged: Keymap = { prefix: DEFAULT_KEYMAP.prefix, keys: { ...DEFAULT_KEYMAP.keys } };

    if (typeof prefix === "string" && parseBinding(prefix, "prefix") !== null) {
        merged.prefix = prefix;
    }

    if (typeof keys === "object" && keys !== null) {
        for (const command of COMMANDS) {
            merged.keys[command] = bindings(Reflect.get(keys, command)) ?? merged.keys[command];
        }
    }

    return merged;
}

function matches(binding: Binding | null, event: KeyEvent): boolean {
    return (
        binding !== null &&
        binding.code === event.code &&
        binding.ctrl === event.ctrlKey &&
        binding.alt === event.altKey &&
        binding.shift === event.shiftKey &&
        binding.meta === event.metaKey
    );
}

function find(keymap: Keymap, event: KeyEvent, prefixed: boolean): Command | null {
    return (
        COMMANDS.find((command) =>
            keymap.keys[command].some((text) => {
                const binding = parseBinding(text);

                return binding?.prefixed === prefixed && matches(binding, event);
            }),
        ) ?? null
    );
}

export type Step = {
    armed: boolean;
    /** The command the key is bound to. A held key repeats it; the caller decides whether to run it again. */
    command: Command | null;
    /** Whether the page must not see the key. */
    consume: boolean;
};

const MODIFIER_CODE = /^(Shift|Control|Alt|Meta)(Left|Right)$/;

/** One key press: idle, the prefix arms, and the next key runs a command or cancels. */
export function step(keymap: Keymap, armed: boolean, event: KeyEvent): Step {
    const prefix = parseBinding(keymap.prefix, "prefix");

    if (armed) {
        if (MODIFIER_CODE.test(event.code)) {
            return { armed, command: null, consume: false };
        }

        if (event.repeat) {
            return { armed, command: null, consume: true };
        }

        // The prefix twice passes the key on, as tmux does: the browser's own ctrl+a still works.
        if (matches(prefix, event)) {
            return { armed: false, command: null, consume: false };
        }

        return { armed: false, command: find(keymap, event, true), consume: true };
    }

    if (matches(prefix, event)) {
        return { armed: !event.repeat, command: null, consume: true };
    }

    const command = find(keymap, event, false);

    return { armed: false, command, consume: command !== null };
}
