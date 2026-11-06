import type { ITheme } from "@xterm/xterm";

/**
 * The terminal's own type, mirroring ~/.config/ghostty/config.ghostty: JetBrainsMonoNL Nerd Font at
 * Light 14.5. Not theme values — a terminal matches the person's shell, not the app's text.
 */
const FONT = '"JetBrainsMonoNL Nerd Font"';
export const FONT_SIZE = 14.5;
export const FONT_WEIGHT = 300;
export const FONT_WEIGHT_BOLD = 600;

/** The local face first, then the app's mono and a symbols font for a machine that lacks it: the browser
 * falls back per glyph, so only the prompt's Private Use Area icons come from the later families. */
export function familyOf(): string {
    return `${FONT}, ${token("--font-mono")}, "Symbols Nerd Font Mono"`;
}

/**
 * The terminal paints with concrete colours, so the theme's are read out of the page at run time: a role
 * for the surface and the ink, Catppuccin's palette names for the ANSI eight. Nothing is a hex of its own.
 */
const THEME = {
    background: "--role-sunken",
    foreground: "--role-ink",
    cursor: "--role-accent",
    cursorAccent: "--role-sunken",
    selectionBackground: "--role-raised",
    black: "--ctp-surface1",
    red: "--ctp-red",
    green: "--ctp-green",
    yellow: "--ctp-yellow",
    blue: "--ctp-blue",
    magenta: "--ctp-pink",
    cyan: "--ctp-teal",
    white: "--ctp-subtext1",
    brightBlack: "--ctp-surface2",
    brightRed: "--ctp-red",
    brightGreen: "--ctp-green",
    brightYellow: "--ctp-yellow",
    brightBlue: "--ctp-blue",
    brightMagenta: "--ctp-pink",
    brightCyan: "--ctp-teal",
    brightWhite: "--ctp-subtext0",
} as const;

function token(variable: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

export function themeOf(): ITheme {
    return Object.fromEntries(
        Object.entries(THEME).map(([key, variable]) => [key, token(variable)]),
    );
}
