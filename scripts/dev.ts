/**
 * The app in development. With no argument: Vite with HMR for the web, and the server under
 * `scripts/serve.ts`, so the Restart button in the app has a parent that starts it again. `web` runs
 * Vite alone and `server` runs the supervised server alone; what follows `web` goes to Vite
 * (`pnpm dev:web --port 5191`). Ctrl+C stops everything that runs, and so does any of it dying.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const [part, ...viteArguments] = process.argv.slice(2);

if (part !== undefined && part !== "web" && part !== "server") {
    console.error(`usage: node scripts/dev.ts [web [vite options] | server]`);
    process.exit(2);
}

const children: ChildProcess[] = [];

if (part !== "web") {
    children.push(spawn(process.execPath, [join(ROOT, "scripts/serve.ts")], { stdio: "inherit" }));
}

if (part !== "server") {
    children.push(spawn(join(ROOT, "node_modules/.bin/vite"), viteArguments, { stdio: "inherit" }));
}

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
