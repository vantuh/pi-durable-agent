/**
 * Terminal: real shells (PTYs) in the session's folder, typed into from the Terminal page. The agent
 * never sees them: no tools, prompt sections or hooks.
 *
 * Shells belong to the folder, one per tab, so every session in that folder sees the same tabs. A shell
 * is kept while the page comes and goes, so the scrollback survives. It ends when its tab stops or
 * closes it, when it exits by itself, when the last session that used the folder's terminal is deleted,
 * or when this version of the extension is disposed and the folder goes or reloads.
 */

import { basename } from "node:path";

import { defineExtension } from "@earendil-works/pi-durable";
import { spawn, type IPty } from "node-pty";

import { ActionError, type Action, type ActionCall, type Host } from "../../server/sdk.ts";
import { recordOf } from "../../shared/guards.ts";
import type { Output, Running, Size, Tab } from "./refs.ts";

export const meta = {
    title: "Terminal",
    description: "Shells in the session's folder, in tabs: real PTYs you type into.",
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
/** The size a new tab starts at: its page resizes it as soon as it has measured the screen. */
const START: Size = { cols: 80, rows: 24 };
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

    /** `onExit` hears the shell ending by itself, not by `dispose`. */
    constructor(cwd: string, size: Size, onExit: () => void) {
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
            if (!this.#exited) {
                onExit();
            }

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

/** One folder's shells by tab, and the sessions that used them: the last of those deleted ends them. */
type Folder = { cwd: string; shells: Map<number, Shell>; sessions: Set<number>; next: number };

/** The folders of this version, by path. A reload builds a new map and the dispose below empties this one. */
const folders = new Map<string, Folder>();

function tabOf(args: unknown): number {
    const tab = recordOf(args)?.["tab"];

    if (typeof tab !== "number" || !Number.isInteger(tab) || tab < 1) {
        throw new ActionError("tab must be a whole number from 1");
    }

    return tab;
}

export const actions = (host: Host): Record<string, Action> => {
    /** The folder of the calling session, which now keeps the folder's shells alive. */
    const folderOf = (call: ActionCall): Folder => {
        if (call.session === null) {
            throw new ActionError("the terminal belongs to a session");
        }

        const cwd = call.session.cwd ?? host.cwd;
        let folder = folders.get(cwd);

        if (folder === undefined) {
            folder = { cwd, shells: new Map(), sessions: new Set(), next: 1 };
            folders.set(cwd, folder);
        }

        folder.sessions.add(call.session.id);

        return folder;
    };

    /** Every session that shows this folder's tabs re-reads them: the header's count moves. */
    const changed = (folder: Folder): void => {
        for (const id of folder.sessions) {
            host.notifySessionChanged(id);
        }
    };

    const start = (folder: Folder, tab: number, size: Size): Shell => {
        const shell = new Shell(folder.cwd, size, () => {
            changed(folder);
        });

        folder.shells.set(tab, shell);

        return shell;
    };

    const shellOf = (call: ActionCall): Shell => {
        const shell = folderOf(call).shells.get(tabOf(call.args));

        if (shell === undefined) {
            throw new ActionError("no shell is running in this tab");
        }

        return shell;
    };

    host.onDispose(() => {
        for (const folder of folders.values()) {
            for (const shell of folder.shells.values()) {
                shell.dispose();
            }
        }

        folders.clear();
    });

    host.onSessionGone((id) => {
        for (const folder of folders.values()) {
            if (folder.sessions.delete(id) && folder.sessions.size === 0) {
                for (const shell of folder.shells.values()) {
                    shell.dispose();
                }

                folders.delete(folder.cwd);
            }
        }
    });

    return {
        list(call): Tab[] {
            return [...folderOf(call).shells].map(([id, shell]) => ({
                id,
                title: shell.running().foreground,
                exited: shell.exited,
            }));
        },

        create(call) {
            const folder = folderOf(call);
            const tab = folder.next;

            folder.next += 1;
            start(folder, tab, START);
            changed(folder);

            return tab;
        },

        open(call) {
            const folder = folderOf(call);
            const tab = tabOf(call.args);
            const size = sizeOf(call.args);
            const shell = folder.shells.get(tab);

            if (shell === undefined) {
                throw new ActionError("no shell is running in this tab");
            }

            if (!shell.exited) {
                shell.resize(size);

                return shell.output(0);
            }

            shell.dispose();

            return start(folder, tab, size).output(0);
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
            shellOf(call).dispose();

            return true;
        },

        remove(call) {
            const folder = folderOf(call);
            const tab = tabOf(call.args);

            folder.shells.get(tab)?.dispose();
            folder.shells.delete(tab);
            changed(folder);

            return true;
        },
    };
};

export default function terminal(host: Host) {
    return defineExtension({ name: host.name });
}
