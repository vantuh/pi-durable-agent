/**
 * Opens the app in a chromeless window (Chrome's `--app`) once it answers, the way Ultimate does;
 * without a Chrome-family browser it opens a plain tab.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const BROWSERS = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "brave",
    "brave-browser",
    "microsoft-edge",
];

function onPath(name: string): boolean {
    return (process.env["PATH"] ?? "").split(":").some((dir) => existsSync(join(dir, name)));
}

function command(url: string): [string, string[]] {
    if (process.platform === "darwin") {
        return existsSync("/Applications/Google Chrome.app")
            ? ["open", ["-na", "Google Chrome", "--args", `--app=${url}`]]
            : ["open", [url]];
    }

    const browser = BROWSERS.find(onPath);

    return browser === undefined ? ["xdg-open", [url]] : [browser, [`--app=${url}`]];
}

export async function openWindow(url: string): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const up = await fetch(url).then(
            (response) => response.ok,
            () => false,
        );

        if (up) {
            const [file, args] = command(url);
            const opener = spawn(file, args, { detached: true, stdio: "ignore" });

            opener.on("error", (error) => {
                console.error(`pi-durable-agent: cannot open ${url}: ${error.message}`);
            });
            opener.unref();

            return;
        }

        await sleep(250);
    }

    console.error(`pi-durable-agent: ${url} did not answer, not opening a window`);
}
