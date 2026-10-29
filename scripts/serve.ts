/**
 * Runs the server, and runs it again when the app asks: `POST /api/restart` ends the process with
 * code 75. Work in flight is durable, so it resumes in the new process.
 *
 * `pnpm serve` and `pnpm start` go through here and only through here: the server cannot start
 * itself again, so without this parent the restart answers 409. `--open` opens the app in its own
 * window.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

import { openWindow } from "./open.ts";

const RESTART_CODE = 75;
const SERVER = join(import.meta.dirname, "../server/main.ts");

let child: ChildProcess | undefined;
let stopping = false;

function run(): void {
    child = spawn(process.execPath, [SERVER], {
        // An IPC channel and nothing else says the server is supervised: an environment variable is
        // inherited by everything this process starts, and would lie to a server started some other way.
        stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    child.on("exit", (code) => {
        if (!stopping && code === RESTART_CODE) {
            console.log("pi-durable-agent: restarting");

            run();

            return;
        }

        process.exit(code ?? 0);
    });
}

// The child is in this process group, so a Ctrl+C reaches it as well; its second stop does nothing.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        stopping = true;
        child?.kill(signal);
    });
}

run();

if (process.argv.includes("--open")) {
    void openWindow(`http://127.0.0.1:${process.env["PORT"] ?? "8788"}`);
}
