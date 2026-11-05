import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal, type ITheme } from "@xterm/xterm";
import { RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type { PanelProps } from "@/sdk/types.ts";
import { Toolbar } from "@/ui/pane.tsx";

import "@xterm/xterm/css/xterm.css";

import { messageOf } from "../../shared/guards.ts";
import { type Output, type Running, close, open, read, resize, state, write } from "./refs.ts";

const RETRY_MS = 2000;
/** The physical key behind a letter: `code` names the position, so it survives a non-Latin layout. */
const KEY_LETTER = /^Key([A-Z])$/;
const sleep = (ms: number): Promise<void> =>
    new Promise((done) => {
        setTimeout(done, ms);
    });
/** What the server answers a session whose shell it no longer holds: a restart, not a hiccup. */
const GONE = "no shell is running";

/**
 * The terminal's own type, mirroring ~/.config/ghostty/config.ghostty: JetBrainsMonoNL Nerd Font at
 * Light 14.5. Not theme values — a terminal matches the person's shell, not the app's text.
 */
const FONT = '"JetBrainsMonoNL Nerd Font"';
const FONT_SIZE = 14.5;
const FONT_WEIGHT = 300;
const FONT_WEIGHT_BOLD = 600;

/** The local face first, then the app's mono and a symbols font for a machine that lacks it: the browser
 * falls back per glyph, so only the prompt's Private Use Area icons come from the later families. */
function familyOf(): string {
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

function themeOf(): ITheme {
    return Object.fromEntries(
        Object.entries(THEME).map(([key, variable]) => [key, token(variable)]),
    );
}

/** The shell of one session, and the terminal that shows it. Keyed by the restart count: a new one starts fresh. */
function Shell({
    id,
    expanded,
    onRestart,
}: {
    id: number;
    expanded: boolean;
    onRestart: () => void;
}) {
    const field = useRef<HTMLDivElement>(null);
    /** Keys typed so far, one request at a time; a stop waits for it before ending the shell. */
    const pending = useRef<Promise<unknown>>(Promise.resolve());
    const terminal = useRef<Terminal | null>(null);
    /** False once the shell is over: nothing may resize it, and no key may be sent to it. */
    const live = useRef(true);
    /** How the shell ended, once it has: by itself or by Stop. Null while it runs. */
    const [over, setOver] = useState<"exited" | "stopped" | null>(null);
    /** The program a Stop or a Restart would end, while the dialog asks about it. */
    const [ask, setAsk] = useState<{ what: "stop" | "restart"; process: string } | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    /** A stop or a restart is on its way: a second click would end a shell that is already ending. */
    const busy = useRef(false);
    /** The same, for the buttons: a ref alone re-renders nothing. */
    const [working, setWorking] = useState(false);
    const inFlight = (value: boolean): void => {
        busy.current = value;
        setWorking(value);
    };

    useEffect(() => {
        const node = field.current;

        if (node === null) {
            return undefined;
        }

        const stop = new AbortController();
        const alive = (): boolean => !stop.signal.aborted && live.current;

        live.current = true;
        let teardown: (() => void) | undefined;

        void (async () => {
            const term = new Terminal({
                theme: themeOf(),
                fontFamily: familyOf(),
                fontSize: FONT_SIZE,
                fontWeight: FONT_WEIGHT,
                fontWeightBold: FONT_WEIGHT_BOLD,
                cursorBlink: true,
                scrollback: 5000,
                // Option+drag selects even under a program that took the mouse, such as nvim.
                macOptionClickForcesSelection: true,
                allowProposedApi: true,
            });
            const fit = new FitAddon();

            terminal.current = term;
            term.loadAddon(fit);
            term.loadAddon(new Unicode11Addon());
            // OSC 52, so a yank in nvim or tmux reaches the browser's clipboard.
            term.loadAddon(new ClipboardAddon());
            term.unicode.activeVersion = "11";

            // The app's mono font is a webfont that swaps in, so the cell is measured before it lands
            // unless it is waited for; the local face needs no loading but is named in the same list.
            await document.fonts
                .load(`${String(FONT_WEIGHT)} ${String(FONT_SIZE)}px ${familyOf()}`)
                .catch(() => []);

            if (!alive()) {
                term.dispose();

                return;
            }

            term.open(node);
            fit.fit();
            term.focus();

            let after = 0;
            // Until `open` has answered there is nothing to resize: it starts the shell at this size.
            let opened = false;
            const size = (): { cols: number; rows: number } => ({
                cols: term.cols,
                rows: term.rows,
            });

            /** A key into the shell, one write at a time: keys already queued go first. */
            const send = (data: string): void => {
                pending.current = pending.current
                    // A key queued before a restart must not reach the shell that replaced it.
                    .then(() => (alive() ? callAction(write, { data }, id) : true))
                    .catch((failure: unknown) => {
                        setProblem(messageOf(failure));
                    });
            };

            term.attachCustomKeyEventHandler((event) => {
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
                    send(String.fromCharCode(letter.charCodeAt(0) - 64));

                    return false;
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
                    term.getSelection() === ""
                ) {
                    send("\u0003");

                    return false;
                }

                // The shell keeps every key it is given: the app closes a panel on Escape and arms its own
                // prefix on Ctrl+A, and neither may take a key out of a terminal.
                event.stopPropagation();

                return true;
            });

            term.onData(send);

            // A selection is a copy, as in the person's own terminal: no key to press. Ctrl+C keeps its
            // meaning, so a server is still stopped by it and not swallowed as "copy".
            const copied = term.onSelectionChange(() => {
                const selected = term.getSelection();

                if (selected !== "") {
                    void navigator.clipboard.writeText(selected).catch(() => true);
                }
            });

            const fitted = new ResizeObserver(() => {
                fit.fit();

                if (opened && alive()) {
                    void callAction(resize, size(), id).catch(() => true);
                }
            });

            fitted.observe(node);

            // A flavour change repaints, without reopening the shell.
            const flavour = new MutationObserver(() => {
                term.options.theme = themeOf();
            });

            flavour.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-flavour"],
            });

            teardown = () => {
                terminal.current = null;
                copied.dispose();
                fitted.disconnect();
                flavour.disconnect();
                term.dispose();
            };

            try {
                const asked = size();
                const started = await callAction(open, asked, id);

                if (!alive()) {
                    return;
                }

                term.write(started.data);
                after = started.seq;
                opened = true;

                // The panel may have been resized while `open` was on its way: the shell still has the
                // size the request carried.
                const now = size();

                if (now.cols !== asked.cols || now.rows !== asked.rows) {
                    void callAction(resize, now, id).catch(() => true);
                }

                while (alive()) {
                    let next: Output | null;

                    try {
                        next = await callAction(read, { after }, id);
                        setProblem(null);
                    } catch (failure) {
                        const message = messageOf(failure);

                        // The server no longer holds this shell: a restart, not a failure to retry.
                        if (message.includes(GONE)) {
                            live.current = false;
                            setOver((was) => was ?? "exited");

                            return;
                        }

                        setProblem(message);
                        await sleep(RETRY_MS);

                        continue;
                    }

                    if (!alive()) {
                        return;
                    }

                    if (next !== null) {
                        term.write(next.data);
                        after = next.seq;

                        if (next.exited) {
                            live.current = false;
                            setOver((was) => was ?? "exited");

                            return;
                        }
                    }
                }
            } catch (failure) {
                if (alive()) {
                    setProblem(messageOf(failure));
                }
            }
        })();

        return () => {
            stop.abort();
            teardown?.();
        };
    }, [id]);

    /**
     * Ends the shell and says whether it is gone. A close that fails leaves the shell live: the panel
     * keeps reading it and says what went wrong, instead of claiming a shell it never ended.
     */
    const end = async (): Promise<boolean> => {
        // Typed keys go first: one of them must not land in the shell this is about to end.
        await pending.current.catch(() => true);

        try {
            await callAction(close, undefined, id);
        } catch (failure) {
            const message = messageOf(failure);

            // A shell that has already gone is the outcome this asks for.
            if (!message.includes(GONE)) {
                setProblem(message);

                return false;
            }
        }

        live.current = false;
        setOver("stopped");

        return true;
    };

    /** The confirmed action: Stop ends the shell, Restart ends it and starts another in its place. */
    const apply = async (what: "stop" | "restart"): Promise<void> => {
        if (busy.current) {
            return;
        }

        inFlight(true);

        try {
            if (over === null && !(await end())) {
                return;
            }

            if (what === "restart") {
                onRestart();
            }
        } finally {
            inFlight(false);
        }
    };

    /**
     * A click on Stop or Restart: asks the server what runs now, asks the person when it is a program
     * and not the shell, then acts. Never the remembered value: a shell's foreground changes by itself.
     */
    const pressed = (what: "stop" | "restart"): void => {
        if (busy.current) {
            return;
        }

        // A shell that has ended runs nothing: there is no program to ask about.
        if (over !== null) {
            void apply(what);

            return;
        }

        inFlight(true);
        void (async () => {
            let running: Running | null;

            try {
                running = await callAction(state, undefined, id);
            } catch (failure) {
                const message = messageOf(failure);

                // Nothing is left to lose when the shell is gone; anything else is said, not hidden.
                if (!message.includes(GONE)) {
                    setProblem(message);
                    inFlight(false);

                    return;
                }

                running = null;
            }

            inFlight(false);

            if (running !== null && running.foreground !== running.shell) {
                setAsk({ what, process: running.foreground });

                return;
            }

            void apply(what);
        })();
    };

    // Full screen takes the keyboard from the button that asked for it: the next thing typed is a command.
    useEffect(() => {
        if (expanded) {
            terminal.current?.focus();
        }
    }, [expanded]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Toolbar className="justify-end">
                <Hint label="Stop the shell">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Stop the shell"
                        disabled={over !== null || working}
                        onClick={() => {
                            pressed("stop");
                        }}
                    >
                        <Square className="size-3 fill-current" />
                    </Button>
                </Hint>
                <Hint label="Restart the shell">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Restart the shell"
                        disabled={working}
                        onClick={() => {
                            pressed("restart");
                        }}
                    >
                        <RotateCcw className="size-4" />
                    </Button>
                </Hint>
            </Toolbar>

            {problem === null ? null : <Alert className="text-interface">{problem}</Alert>}

            {over === null ? null : (
                <div className="border-edge-soft text-meta text-faint flex items-center gap-2 border-b px-3 py-1.5">
                    {over === "stopped" ? "The shell stopped." : "The shell exited."}
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={working}
                        onClick={() => {
                            pressed("restart");
                        }}
                    >
                        Start a new shell
                    </Button>
                </div>
            )}

            {ask === null ? null : (
                <AlertDialog
                    open
                    onOpenChange={(showing) => {
                        if (!showing) {
                            setAsk(null);
                        }
                    }}
                >
                    <AlertDialogContent
                        onCloseAutoFocus={(event) => {
                            // The dialog took the keyboard from the terminal; give it back.
                            event.preventDefault();
                            terminal.current?.focus();
                        }}
                    >
                        <AlertDialogHeader>
                            <AlertDialogTitle>{ask.process} is still running.</AlertDialogTitle>
                            <AlertDialogDescription>
                                {ask.what === "stop"
                                    ? "Stop the shell anyway?"
                                    : "Restart the shell anyway?"}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>No</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={(event) => {
                                    event.preventDefault();
                                    setAsk(null);
                                    // Already answered: the question is not asked a second time.
                                    void apply(ask.what);
                                }}
                            >
                                Yes, {ask.what === "stop" ? "stop" : "restart"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            {/* `data-own-keys`: the hotkeys extension leaves every key to a surface that says this. */}
            <div
                ref={field}
                data-own-keys
                className="bg-sunken min-h-0 flex-1 overflow-hidden p-2"
            />
        </div>
    );
}

export function TerminalPanel({ session, expanded }: PanelProps) {
    const id = session?.id ?? null;
    // A new shell is a new terminal: the effect starts again instead of reusing what the old one fitted.
    const [generation, setGeneration] = useState(0);

    if (id === null) {
        return <Empty className="text-interface p-3">Open a session to use the terminal.</Empty>;
    }

    return (
        <Shell
            key={generation}
            id={id}
            expanded={expanded}
            onRestart={() => {
                setGeneration((value) => value + 1);
            }}
        />
    );
}
