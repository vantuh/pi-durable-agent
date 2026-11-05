/** Key bindings, the keymap and the prefix state machine. Browser-safe: no imports. */

/**
 * The commands this keymap binds (`ShellCommand`), the shell's own and the extension commands it gives
 * a default to. A command missing here is not bound, however a file names it: `web.tsx` compiles
 * against this list, and the core narrows an extension command by its `extension.` prefix alone.
 */
export const COMMANDS = [
    "session.new",
    "session.new.pick",
    "folder.pick",
    "session.search",
    "session.rename",
    "session.prev",
    "session.next",
    // An extension's own command, named `extension.<folder>.<command>`. The core names none of them.
    "extension.git-history.open",
] as const;

export type Command = (typeof COMMANDS)[number];

/** Binding strings such as `ctrl+a`, `prefix+c` or `shift+left`; a command may have several. */
export type Keymap = { prefix: string; keys: Record<Command, string[]> };

export const DEFAULT_KEYMAP: Keymap = {
    prefix: "ctrl+a",
    keys: {
        // A new session in the folder on screen, or one picked by hand; the sidebar's `+` picks too.
        "session.new": [],
        "session.new.pick": ["prefix+c"],
        "folder.pick": ["prefix+s"],
        "session.search": ["prefix+f"],
        "session.rename": ["prefix+r", "prefix+,"],
        "session.prev": ["shift+left", "prefix+p"],
        "session.next": ["shift+right", "prefix+n"],
        // Git history's commit list, for the conversation on screen.
        "extension.git-history.open": ["prefix+g"],
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

/** The tokens of a binding, read as `parseBinding` reads them: trimmed, lowercase, none empty. */
function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .split("+")
        .map((part) => part.trim())
        .filter((part) => part !== "");
}

/** `ctrl+a` as the caps it is: one per key, in the order it is pressed, a repeated modifier once. */
export function caps(text: string): string[] {
    return [...new Set(tokens(text))];
}

/**
 * A binding as the presses it is drawn as: the prefix's own keys, then the key it arms. A binding
 * without the prefix is one press. Its tokens are normalised as `parseBinding` normalises them, so
 * `PREFIX + F` and `prefix+f` are one binding drawn one way.
 */
export function presses(keymap: Keymap, text: string): string[][] {
    const parts = tokens(text);
    const key = parts.filter((part) => part !== "prefix");

    return key.length === parts.length ? [caps(text)] : [caps(keymap.prefix), caps(key.join("+"))];
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

/** The part of a DOM element the shell asks about: what it is, and whether it is being typed into. */
export type Target = { tagName: string; isContentEditable: boolean };

/** The same, plus the one question a field asks of its ancestors: whether it opted into the shell's keys. */
export type Field = Target & { closest(selector: string): object | null };

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
// The composer carries it: the shell's keys reach it, so the arrows still switch sessions while typing.
const SHELL_KEYS = "[data-shell-keys]";
// A terminal carries it: everything typed there is the shell's, the prefix key included.
const OWN_KEYS = "[data-own-keys]";

/** A field owns the keys typed into it: an unprefixed shortcut would eat the text the person writes. */
export function ownsKeys(target: Target): boolean {
    return FIELD.test(target.tagName) || target.isContentEditable;
}

/** Whether the key is the keymap's prefix, the one key no field may keep: it is what arms the shell. */
function arms(keymap: Keymap, event: KeyEvent): boolean {
    return matches(parseBinding(keymap.prefix, "prefix"), event);
}

/**
 * Whether a field keeps the key: everything it types, but neither the prefix nor the keys it opted out of.
 * A surface that handles every key of its own — a terminal — keeps the prefix too, or Ctrl+A never
 * reaches the shell that needs it.
 */
export function fieldKeeps(target: Field, keymap: Keymap, event: KeyEvent): boolean {
    return (
        target.closest(OWN_KEYS) !== null ||
        (ownsKeys(target) && !arms(keymap, event) && target.closest(SHELL_KEYS) === null)
    );
}

// A confirmation is an alert dialog, which is a dialog to the keyboard as well as to the screen reader.
const DIALOG = '[role="dialog"], [role="alertdialog"]';

/** Whether the focus is inside a dialog: the shell's keys must not fire behind one. */
export function inDialog(focus: { closest(selector: string): object | null } | null): boolean {
    return focus !== null && focus.closest(DIALOG) !== null;
}

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
