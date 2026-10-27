/**
 * Browser: a real Chromium on this machine. Pi drives it with the `browser` tool; the person
 * watches and uses the same page in the Browser panel. Ported from Pi Pocket (see lib/NOTICE.md).
 *
 * A call is not replayed after a restart (clicking twice is not harmless), and the page itself
 * does not survive one: its address comes back when it opens again, not what was typed on it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { awaitWithContext } from "@earendil-works/chord/context";
import { AgentDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "typebox";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import { Browsers } from "./lib/browsers.ts";
import { BrowserError } from "./lib/cdp.ts";
import type { BrowserPage, LogEntry, Saved, Target } from "./lib/page.ts";
import { displayUrl, normalizeUrl } from "./lib/urls.ts";
import { presetOf, viewportFrom } from "./lib/viewport.ts";

export const meta = {
    title: "Browser",
    description: "A real Chromium that Pi drives and you watch in the Browser panel.",
};

const ACTIONS = [
    "navigate",
    "snapshot",
    "screenshot",
    "click",
    "type",
    "press",
    "select",
    "hover",
    "scroll",
    "wait",
    "evaluate",
    "console",
    "back",
    "forward",
    "reload",
    "viewport",
] as const;

type ToolAction = (typeof ACTIONS)[number];

/** Actions that may change the page, after which a snapshot can come along. */
const CHANGING = new Set<ToolAction>([
    "navigate",
    "click",
    "type",
    "press",
    "select",
    "back",
    "forward",
    "reload",
    "viewport",
]);
const MAX_TEXT = 20_000;

const GUIDE = `You have a browser tool: a real Chromium on this machine. The person sees the same page live in the app's Browser panel and can click and type in it too, so it is how you show and test web work: local dev servers (http://localhost:5173), HTML files on this machine (give their path), or any site.
- Start a dev server in the background with bash first, then navigate to it.
- snapshot lists the page's text and its controls with refs like [e12]; click, type, select, and hover take a ref (or a CSS selector, or the visible label). Refs last until the next snapshot.
- screenshot shows you how the page looks: use it to check layout and styling. viewport switches between mobile, tablet, and desktop sizes.
- After a change, check console for errors. evaluate runs JavaScript in the page.`;

const clip = (text: string, max = MAX_TEXT): string =>
    text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;

function where(page: BrowserPage): string {
    const { viewport } = page;
    const size = `${presetOf(viewport) ?? "custom"} ${viewport.width}×${viewport.height}`;
    const url = page.url === "about:blank" ? "a blank page" : page.url;

    return `Page: ${page.title === "" ? "" : `"${page.title}" · `}${url} · ${size}`;
}

function formatLog(entry: LogEntry): string {
    if (entry.level === "nav") {
        return `--- navigated to ${entry.text} ---`;
    }

    return `[${entry.level}] ${entry.text}${entry.source === undefined ? "" : ` (${entry.source})`}`;
}

function required<T>(value: T | undefined, action: string, what: string): T {
    if (value === undefined) {
        throw new Error(`${action} needs ${what}.`);
    }

    return value;
}

/** The last address and size of each session, so a page opens where it was. */
function savedStore(file: string) {
    let all: Record<string, Saved> = {};

    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

        if (typeof parsed === "object" && parsed !== null) {
            all = Object.fromEntries(Object.entries(parsed));
        }
    } catch {
        all = {};
    }

    return {
        load: (id: number): Promise<Saved | undefined> => Promise.resolve(all[String(id)]),
        save: (id: number, saved: Saved): void => {
            all[String(id)] = saved;
            mkdirSync(join(file, ".."), { recursive: true });
            writeFileSync(file, JSON.stringify(all));
        },
    };
}

const instances = new WeakMap<Host, Browsers>();

declare global {
    // A reload builds a new version of this module; the running Chromium and its pages outlive it.
    var piDurableBrowser: { browsers: Browsers; version: number } | undefined;
}

function browsersOf(host: Host): Browsers {
    const found = instances.get(host);

    if (found === undefined) {
        throw new Error("the browser is not running");
    }

    return found;
}

export default function createBrowser(host: Host) {
    const store = savedStore(join(host.dataDir, "browser", "saved.json"));
    const kept = globalThis.piDurableBrowser;
    const version = (kept?.version ?? 0) + 1;
    const browsers =
        kept?.browsers ??
        new Browsers({
            dataDir: host.dataDir,
            load: store.load,
            save: store.save,
            log: host.log,
        });

    globalThis.piDurableBrowser = { browsers, version };
    instances.set(host, browsers);
    // The old version is disposed after the new one was built: close only when nothing replaced it.
    host.onDispose(async () => {
        if (globalThis.piDurableBrowser?.version === version) {
            globalThis.piDurableBrowser = undefined;
            await browsers.closeAll({ final: true });
        }
    });

    const browser = defineTool({
        name: "browser",
        description:
            "Use a real web browser (Chromium on this machine) that the person watches live. Open pages (local dev servers, files, sites), read them as a snapshot with element refs, click, type, take screenshots you can see, read console errors, and run JavaScript in the page.",
        parameters: Type.Object({
            action: Type.Union(
                ACTIONS.map((action) => Type.Literal(action)),
                {
                    description:
                        "navigate (url), snapshot, screenshot, click/hover (ref, selector, label, or x and y), type (text into ref/selector/label, or the focused element), press (key), select (value in a select element), scroll (to ref/selector/label, or by dy), wait (text, selector, or timeoutMs), evaluate (script), console, back, forward, reload, viewport.",
                },
            ),
            url: Type.Optional(
                Type.String({
                    description:
                        "navigate: an http(s) URL, host:port such as localhost:5173, or a path to an HTML file on this machine.",
                }),
            ),
            ref: Type.Optional(
                Type.String({ description: "An element ref from the last snapshot, such as e12." }),
            ),
            selector: Type.Optional(
                Type.String({
                    description: "Instead of ref: a CSS selector. wait: wait until it is visible.",
                }),
            ),
            label: Type.Optional(
                Type.String({
                    description:
                        "Instead of ref: the element's visible text or label, such as a button's text.",
                }),
            ),
            x: Type.Optional(
                Type.Number({
                    description:
                        "click, hover: a point in CSS pixels of the viewport, as seen in a screenshot (one shown smaller says how to scale its points).",
                }),
            ),
            y: Type.Optional(Type.Number()),
            text: Type.Optional(
                Type.String({
                    description:
                        "type: the text to type (empty clears the field). wait: text to wait for.",
                }),
            ),
            submit: Type.Optional(Type.Boolean({ description: "type: press Enter afterwards." })),
            append: Type.Optional(
                Type.Boolean({
                    description: "type: add to what the field holds instead of replacing it.",
                }),
            ),
            key: Type.Optional(
                Type.String({
                    description:
                        "press: a key or combination, such as Enter, Escape, Tab, ArrowDown, Control+A.",
                }),
            ),
            value: Type.Optional(
                Type.String({ description: "select: the option's value or text." }),
            ),
            dy: Type.Optional(
                Type.Number({
                    description:
                        "scroll: pixels down (negative: up). Default: most of a screen down.",
                }),
            ),
            script: Type.Optional(
                Type.String({
                    description:
                        "evaluate: JavaScript run in the page: an expression or statements (top-level await works), or a body that ends with return. Its value comes back as JSON.",
                }),
            ),
            viewport: Type.Optional(
                Type.String({
                    description:
                        "viewport: mobile (390×844), tablet (820×1180), desktop (1280×800), or WIDTHxHEIGHT.",
                }),
            ),
            fullPage: Type.Optional(
                Type.Boolean({
                    description: "screenshot: the whole page, not only what fits the viewport.",
                }),
            ),
            timeoutMs: Type.Optional(
                Type.Number({
                    description:
                        "navigate, wait: how long to wait in milliseconds (default 30000 for navigate, 10000 for wait).",
                }),
            ),
            snapshot: Type.Optional(
                Type.Boolean({
                    description: "After an action that changes the page: also return its snapshot.",
                }),
            ),
            clear: Type.Optional(
                Type.Boolean({ description: "console: clear the lines after reading them." }),
            ),
        }),
        // Pages are shared and stateful: a round's calls run in order.
        executionMode: "sequential",
        execute: async (args, api, context) => {
            const action: ToolAction = args.action;
            const name: string = action;
            const signal = context.abortSignal;
            const sig = signal === undefined ? {} : { signal };
            const agent = await api.snapshot(AgentDoc, api.conversationId, context);
            const cwd = agent?.cwd ?? process.cwd();
            const page = await awaitWithContext(
                browsers.open(Number(api.conversationId), { restore: action !== "navigate" }),
                context,
            );
            const before = page.logSeq;
            const target: Target = {
                ...(args.ref === undefined ? {} : { ref: args.ref.replace(/^\[|\]$/g, "") }),
                ...(args.selector === undefined ? {} : { selector: args.selector }),
                ...(args.label === undefined ? {} : { label: args.label }),
                ...(args.x === undefined || args.y === undefined ? {} : { x: args.x, y: args.y }),
            };
            const pointed = Object.keys(target).length > 0;
            const lines: string[] = [];
            let image: { data: string } | undefined;
            let failed = false;
            const run = <T>(promise: Promise<T>) => awaitWithContext(promise, context);
            const aim = (): Target => {
                if (!pointed) {
                    throw new Error(`${name} needs a ref, selector, label, or x and y.`);
                }

                return target;
            };

            switch (action) {
                case "navigate": {
                    const given = required(args.url, action, "a url");
                    const url = normalizeUrl(given, { trusted: true, cwd });

                    if (url === undefined) {
                        throw new Error(
                            `"${given}" is not an address the browser opens: give an http(s) URL, host:port, or a file path.`,
                        );
                    }

                    const result = await run(
                        page.navigate(url, { timeoutMs: args.timeoutMs ?? 30_000, ...sig }),
                    );

                    if (result.error === undefined) {
                        lines.push(
                            `Opened ${url}${result.status === undefined ? "" : ` (HTTP ${result.status})`}.`,
                        );

                        if (result.slow === true) {
                            lines.push("It is still loading.");
                        }
                    } else {
                        failed = true;
                        const refused = result.error.includes("CONNECTION_REFUSED");

                        lines.push(
                            `Could not open ${url}: ${result.error}.${refused ? " Nothing answers there: is the server running?" : ""}`,
                        );
                    }

                    break;
                }

                case "back":
                case "forward": {
                    const moved = await run(page.go(action === "back" ? -1 : 1, sig));

                    lines.push(moved ? `Went ${name}.` : `There is no page to go ${name} to.`);
                    break;
                }

                case "reload":
                    await run(page.reload(sig));
                    lines.push("Reloaded.");
                    break;

                case "snapshot":
                    break;

                case "screenshot": {
                    const shot = await run(page.screenshot({ fullPage: args.fullPage === true }));
                    // Models refuse bigger images once a conversation holds many, so a big page comes back smaller.
                    const smaller =
                        shot.scale < 1
                            ? `, shown at ${Math.round(shot.width * shot.scale)}×${Math.round(shot.height * shot.scale)}: multiply a point in it by ${(1 / shot.scale).toFixed(2)} for CSS pixels`
                            : "";

                    image = { data: shot.data };
                    lines.push(
                        `Screenshot of ${args.fullPage === true ? "the whole page" : "the viewport"}, ${shot.width}×${shot.height} CSS pixels${smaller}.`,
                    );
                    break;
                }

                case "click": {
                    const clicked = await run(page.click(aim(), sig));

                    lines.push(`Clicked ${clicked.label}.`);

                    if (clicked.covered !== undefined) {
                        lines.push(
                            `Something else was on top of it: ${clicked.covered}, which got the click.`,
                        );
                    }

                    if (clicked.navigated) {
                        lines.push(`The page changed to ${page.url}.`);
                    }

                    break;
                }

                case "hover":
                    lines.push(`The mouse is over ${await run(page.hover(aim()))}.`);
                    break;

                case "type": {
                    const text = required(args.text, action, "text");
                    const into = await run(
                        page.type(pointed ? target : undefined, text, {
                            ...(args.append === undefined ? {} : { append: args.append }),
                            ...(args.submit === undefined ? {} : { submit: args.submit }),
                            ...sig,
                        }),
                    );

                    lines.push(
                        text === ""
                            ? `Cleared ${into}.`
                            : `Typed into ${into}${args.submit === true ? " and pressed Enter" : ""}.`,
                    );
                    break;
                }

                case "press": {
                    const key = required(args.key, action, "a key");

                    await run(page.press(key, sig));
                    lines.push(`Pressed ${key}.`);
                    break;
                }

                case "select": {
                    const value = required(args.value, action, "a value");

                    lines.push(`Selected "${await run(page.select(aim(), value))}".`);
                    break;
                }

                case "scroll":
                    lines.push(
                        `Scrolled ${pointed ? "to " : ""}${await run(page.scroll(pointed ? target : undefined, args.dy))}.`,
                    );
                    break;

                case "wait": {
                    const found = await run(
                        page.waitFor({
                            ...(args.text === undefined ? {} : { text: args.text }),
                            ...(args.selector === undefined ? {} : { selector: args.selector }),
                            ...(args.timeoutMs === undefined
                                ? {}
                                : { timeoutMs: args.timeoutMs, ms: args.timeoutMs }),
                            ...sig,
                        }),
                    );
                    const what = args.text === undefined ? args.selector : `"${args.text}"`;

                    if (what === undefined) {
                        lines.push("Waited.");
                    } else if (found) {
                        lines.push(`Found ${what}.`);
                    } else {
                        failed = true;
                        lines.push(`${what} did not show up in time.`);
                    }

                    break;
                }

                case "evaluate": {
                    const script = required(args.script, action, "a script");

                    lines.push(
                        clip(
                            await run(
                                page.evaluate(script, { timeoutMs: args.timeoutMs ?? 30_000 }),
                            ),
                        ),
                    );
                    break;
                }

                case "console": {
                    const entries = page.logs();

                    lines.push(
                        entries.length === 0
                            ? "The console is empty."
                            : clip(entries.map(formatLog).join("\n")),
                    );

                    if (args.clear === true) {
                        page.clearLogs();
                    }

                    break;
                }

                case "viewport": {
                    const viewport = viewportFrom(args.viewport);

                    if (viewport === undefined) {
                        throw new Error("viewport needs mobile, tablet, desktop, or WIDTHxHEIGHT.");
                    }

                    await run(page.setViewport(viewport));
                    lines.push(
                        `The page is now ${presetOf(viewport) ?? "custom"} ${viewport.width}×${viewport.height}.`,
                    );
                    break;
                }
            }

            if (action === "snapshot" || (args.snapshot === true && CHANGING.has(action))) {
                const outline = await run(page.snapshot());
                const below = outline.scrollHeight - outline.scrollY - outline.innerHeight;

                lines.push(
                    `Snapshot (scrolled ${outline.scrollY} of ${outline.scrollHeight}px${below > 0 ? `, ${below}px below the viewport` : ""}):`,
                    outline.lines === "" ? "(no text or controls)" : outline.lines,
                );

                if (outline.truncated) {
                    lines.push(
                        "… the snapshot stops here: scroll, or use evaluate to read the rest.",
                    );
                }
            }

            if (action !== "console") {
                const errors = page
                    .logs(before)
                    .filter((entry) => entry.level === "error" || entry.level === "dialog");

                if (errors.length > 0) {
                    lines.push(
                        "Console errors and dialogs during this call:",
                        ...errors.slice(0, 10).map((entry) => `- ${formatLog(entry)}`),
                        ...(errors.length > 10
                            ? [`- … and ${errors.length - 10} more (see console)`]
                            : []),
                    );
                }
            }

            lines.push(where(page));

            return {
                output: [
                    { type: "text" as const, text: lines.join("\n") },
                    ...(image === undefined
                        ? []
                        : [{ type: "image" as const, data: image.data, mimeType: "image/jpeg" }]),
                ],
                ...(failed ? { isError: true } : {}),
                details: {
                    action,
                    url: page.url,
                    address: displayUrl(page.url),
                    title: page.title,
                },
            };
        },
    });

    return defineExtension({
        name: host.name,
        tools: [browser],
        sections: [
            section("browser", (input) =>
                input.agent.tools.some((tool) => tool.name === "browser") ? GUIDE : undefined,
            ),
        ],
    });
}

/** The browser's own failures (none installed, it crashed) are the person's to read. */
async function readable<T>(work: Promise<T>): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw error instanceof BrowserError ? new ActionError(error.message) : error;
    }
}

function field(args: unknown, name: string): unknown {
    return typeof args === "object" && args !== null ? Reflect.get(args, name) : undefined;
}

export const actions = (host: Host): Record<string, Action> => {
    const browsers = browsersOf(host);
    const idOf = ({ session }: Parameters<Action>[0]): number => {
        if (session === null) {
            throw new ActionError("the browser belongs to a session");
        }

        return session.id;
    };
    const pageOf = (id: number): BrowserPage => {
        const page = browsers.page(id);

        if (page === undefined) {
            throw new ActionError("Nothing is open in the browser.");
        }

        return page;
    };

    return {
        state: (call) => browsers.state(idOf(call)),

        logs: (call) => browsers.page(idOf(call))?.logs() ?? [],

        async frame(call) {
            const page = browsers.page(idOf(call));
            const after = Number(field(call.args, "after")) || 0;
            const frame = await page?.frame(after);

            if (frame === undefined) {
                return null;
            }

            return {
                seq: frame.seq,
                width: frame.width,
                height: frame.height,
                image: frame.data.toString("base64"),
            };
        },

        async input(call) {
            const events = field(call.args, "events");

            if (!Array.isArray(events)) {
                throw new ActionError("events must be a list");
            }

            await readable(pageOf(idOf(call)).input(events.slice(0, 200)));

            return true;
        },

        async control(call) {
            const id = idOf(call);
            const op = field(call.args, "op");

            if (op === "stop" || op === "clear") {
                const page = pageOf(id);

                if (op === "stop") {
                    await readable(page.stop());
                } else {
                    page.clearLogs();
                }

                return browsers.state(id);
            }

            const viewport = viewportFrom(field(call.args, "viewport"));
            const rawUrl = field(call.args, "url");
            const target =
                op === "navigate"
                    ? normalizeUrl(typeof rawUrl === "string" ? rawUrl : "", {
                          trusted: true,
                          cwd: call.session?.cwd ?? host.cwd,
                      })
                    : undefined;

            if (op === "navigate" && target === undefined) {
                throw new ActionError(
                    "That is not an address: try localhost:5173, example.com, or a file path.",
                );
            }

            if (op === "viewport" && viewport === undefined) {
                throw new ActionError("Say mobile, tablet, desktop, or a size such as 1024x768.");
            }

            try {
                // Opening restores the last address without waiting for it: frames show it loading.
                const page = await browsers.open(id, {
                    wait: false,
                    restore: op !== "navigate",
                    ...(viewport === undefined ? {} : { viewport }),
                });

                if (op === "navigate" && target !== undefined) {
                    const result = await page.navigate(target, { wait: false });

                    return {
                        ...browsers.state(id),
                        ...(result.error === undefined ? {} : { error: result.error }),
                    };
                }

                if (op === "back" || op === "forward") {
                    await page.go(op === "back" ? -1 : 1, { wait: false });
                } else if (op === "reload") {
                    await page.reload({ wait: false });
                } else if (op === "viewport" && viewport !== undefined) {
                    await page.setViewport(viewport);
                } else if (op !== "open") {
                    throw new ActionError("unknown browser operation");
                }

                return browsers.state(id);
            } catch (error) {
                throw error instanceof BrowserError ? new ActionError(error.message) : error;
            }
        },
    };
};
