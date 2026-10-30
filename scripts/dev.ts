/**
 * One command for the whole app in development: Vite with HMR for the web, and the server under
 * `scripts/serve.ts`, so the Restart button in the app has a parent that starts it again.
 * Ctrl+C stops both, and so does either of them dying.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const children: ChildProcess[] = [
    spawn(process.execPath, [join(ROOT, "scripts/serve.ts")], { stdio: "inherit" }),
    spawn(join(ROOT, "node_modules/.bin/vite"), [], { stdio: "inherit" }),
];

let stopping = false;
let running = children.length;

function stop(): void {
    if (stopping) {
        return;
    }

    stopping = true;

    for (const child of children) {
        child.kill("SIGTERM");
    }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, stop);
}

for (const child of children) {
    child.on("exit", (code) => {
        stop();
        running -= 1;

        if (running === 0) {
            process.exit(code ?? 0);
        }
    });
}
