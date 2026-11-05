/**
 * Terminal: a real shell (a PTY) in the session's folder, typed into from the Terminal panel. The agent
 * never sees it: no tools, prompt sections or hooks.
 *
 * One shell per session, started by the first `open` and kept while the panel comes and goes, so the
 * scrollback survives the tab being closed. It ends when the panel closes it, when it exits by itself,
 * or when this version of the extension is disposed and the folder goes or reloads.
 */

import { basename } from "node:path";

import { defineExtension } from "@earendil-works/pi-durable";
import { spawn, type IPty } from "node-pty";

import { ActionError, type Action, type ActionCall, type Host } from "../../server/sdk.ts";
import { recordOf } from "../../shared/guards.ts";
import type { Output, Running, Size } from "./refs.ts";

export const meta = {
    title: "Terminal",
    description: "A shell in the session's folder: a real PTY you type into.",
};

/** The scrollback a panel gets when it attaches: the last screens and more. */
const BUFFER = 256 * 1024;
/** How long a read waits for output before it answers that nothing came. */
const POLL_MS = 25_000;
/** Output that arrives inside this window of the first leaves as one answer, not one per chunk. */
const BATCH_MS = 8;
/** How long a shell that ignores the hangup gets before its process group is killed outright. */
const KILL_MS = 2000;
const MAX_SIDE = 32_767;
const TERM = "xterm-256color";

/** What would make the shell think it runs inside the agent or an editor, with a name to tell them by. */
const DROPPED = new Set(["TERM_PROGRAM", "TMUX", "FORCE_COLOR", "CLAUDECODE"]);

function loginShell(): string {
    const shell = process.env["SHELL"];

    return shell === undefined || shell === "" ? "/bin/zsh" : shell;
}

function environment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (!DROPPED.has(key) && !key.startsWith("VSCODE_") && !key.startsWith("PI_")) {
            env[key] = value;
        }
    }

    env["TERM"] = TERM;
    env["COLORTERM"] = "truecolor";

    return env;
}

function side(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
}

function sizeOf(args: unknown): Size {
    const given = recordOf(args);
    const cols = given?.["cols"];
    const rows = given?.["rows"];

    if (!side(cols) || !side(rows)) {
        throw new ActionError(`cols and rows must be integers from 1 to ${String(MAX_SIDE)}`);
    }

    return { cols, rows };
}

type Waiter = { after: number; answer: (output: Output | null) => void; timer: NodeJS.Timeout };

/** The last `cap` characters of `data`, starting on a whole character: half a surrogate pair is no character. */
export function tail(data: string, cap: number): string {
    if (data.length <= cap) {
        return data;
    }

    const kept = data.slice(-cap);
    const first = kept.charCodeAt(0);

    return first >= 0xdc00 && first <= 0xdfff ? kept.slice(1) : kept;
}

/** One shell and the output nobody has read yet. */
class Shell {
    readonly #pty: IPty;
    readonly #waiters: Waiter[] = [];
    #data = "";
    #seq = 0;
    #exited = false;
    /** The child is gone and reaped, which is not the same as having been reported as exited. */
    #gone = false;
    #killer: NodeJS.Timeout | undefined;
    #batched = false;

    constructor(cwd: string, size: Size) {
        this.#pty = spawn(loginShell(), process.platform === "darwin" ? ["-l"] : [], {
            name: TERM,
            cols: size.cols,
            rows: size.rows,
            cwd,
            env: environment(),
        });

        this.#pty.onData((data) => {
            this.#push(data);
        });
        this.#pty.onExit(() => {
            this.#exited = true;
            this.#gone = true;
            clearTimeout(this.#killer);
            this.#wake();
        });
    }

    get exited(): boolean {
        return this.#exited;
    }

    /** The shell and whatever it runs now, by name: the panel asks before ending a program that is not it. */
    running(): Running {
        const shell = basename(loginShell());

        // A pty that has ended has no foreground job, and reading one would touch a closed descriptor.
        return { shell, foreground: this.#exited ? shell : basename(this.#pty.process) };
    }

    /** What the shell has sent since `after`: everything, for zero. */
    output(after: number): Output {
        // The buffer's first character, so a reader that fell behind it gets what is left from its start.
        const from = Math.max(0, after - (this.#seq - this.#data.length));

        return { seq: this.#seq, data: this.#data.slice(from), exited: this.#exited };
    }

    /** The output after `after`, or the wait for it: null when nothing came in 25 seconds. */
    async read(after: number): Promise<Output | null> {
        if (this.#seq > after || this.#exited) {
            return this.output(after);
        }

        return new Promise<Output | null>((answer) => {
            const waiter: Waiter = {
                after,
                answer,
                timer: setTimeout(() => {
                    this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
                    answer(null);
                }, POLL_MS),
            };

            this.#waiters.push(waiter);
        });
    }

    write(data: string): void {
        if (!this.#exited) {
            this.#pty.write(data);
        }
    }

    resize(size: Size): void {
        if (!this.#exited) {
            this.#pty.resize(size.cols, size.rows);
        }
    }

    dispose(): void {
        if (this.#exited) {
            this.#wake();

            return;
        }

        this.#exited = true;
        this.#wake();

        // node-pty's own kill is one SIGHUP to the shell, which a shell that traps it survives: the
        // process group is the shell's (it is a session leader), so the group goes, jobs included.
        const pid = this.#pty.pid;
        const signal = (name: NodeJS.Signals): void => {
            try {
                process.kill(-pid, name);
            } catch {
                // ESRCH: the group is already gone, which is what was wanted.
            }
        };

        signal("SIGHUP");
        this.#killer = setTimeout(() => {
            if (!this.#gone) {
                signal("SIGKILL");
            }
        }, KILL_MS);
        this.#killer.unref();
    }

    #push(data: string): void {
        this.#data += data;
        this.#seq += data.length;

        if (this.#data.length > BUFFER) {
            this.#data = tail(this.#data, BUFFER);
        }

        if (!this.#batched) {
            this.#batched = true;
            setTimeout(() => {
                this.#batched = false;
                this.#wake();
            }, BATCH_MS);
        }
    }

    #wake(): void {
        for (const waiter of this.#waiters.splice(0)) {
            clearTimeout(waiter.timer);
            waiter.answer(this.output(waiter.after));
        }
    }
}

/** The shells of this version, by session. A reload builds a new map and the dispose below empties this one. */
const shells = new Map<number, Shell>();

export const actions = (host: Host): Record<string, Action> => {
    const at = (call: ActionCall): { id: number; cwd: string } => {
        if (call.session === null) {
            throw new ActionError("the terminal belongs to a session");
        }

        return { id: call.session.id, cwd: call.session.cwd ?? host.cwd };
    };

    const shellOf = (call: ActionCall): Shell => {
        const shell = shells.get(at(call).id);

        if (shell === undefined) {
            throw new ActionError("no shell is running in this session");
        }

        return shell;
    };

    host.onDispose(() => {
        for (const shell of shells.values()) {
            shell.dispose();
        }

        shells.clear();
    });

    host.onSessionGone((id) => {
        shells.get(id)?.dispose();
        shells.delete(id);
    });

    return {
        open(call) {
            const { id, cwd } = at(call);
            const size = sizeOf(call.args);
            const shell = shells.get(id);

            if (shell !== undefined && !shell.exited) {
                shell.resize(size);

                return shell.output(0);
            }

            shell?.dispose();
            const started = new Shell(cwd, size);

            shells.set(id, started);

            return started.output(0);
        },

        write(call) {
            const data = recordOf(call.args)?.["data"];

            if (typeof data !== "string") {
                throw new ActionError("data must be a string");
            }

            shellOf(call).write(data);

            return true;
        },

        state(call) {
            return shellOf(call).running();
        },

        read(call) {
            const after = recordOf(call.args)?.["after"];

            if (typeof after !== "number" || !Number.isInteger(after) || after < 0) {
                throw new ActionError("after must be a whole number of characters");
            }

            return shellOf(call).read(after);
        },

        resize(call) {
            shellOf(call).resize(sizeOf(call.args));

            return true;
        },

        close(call) {
            const { id } = at(call);

            shells.get(id)?.dispose();
            shells.delete(id);

            return true;
        },
    };
};

export default function terminal(host: Host) {
    return defineExtension({ name: host.name });
}
