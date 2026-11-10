/**
 * Agent Browser: the `browser` tool of extensions/browser, run by the agent-browser CLI (vercel-labs/agent-browser)
 * instead of our own DevTools driver. Same tool name and schema, so the two can be compared: turn one on at a time,
 * since both provide `browser` and the loader refuses the second.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { AgentDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { bool, lit, num, obj, opt, str, union } from "@earendil-works/pi-schema";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import { messageOf, recordOf } from "../../shared/guards.ts";
import { run, sessionOf } from "./server/cli.ts";
import { displayUrl, normalizeUrl } from "./server/urls.ts";

export const meta = {
    title: "Agent Browser",
    description:
        "The browser tool on agent-browser (Vercel Labs) instead of our own driver. Turn Browser off first.",
    toggle: true,
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
- snapshot lists the page's accessibility tree with refs like [ref=e12]; click, type, select, and hover take a ref (or a CSS selector, or the visible label). Take a new snapshot after the page changes.
- screenshot shows you how the page looks: use it to check layout and styling. viewport switches between mobile, tablet, and desktop sizes.
- After a change, check console for errors. evaluate runs JavaScript in the page.`;

/** The presets of extensions/browser: width, height, device scale. */
const VIEWPORTS: Record<string, [number, number, number]> = {
    mobile: [390, 844, 2],
    tablet: [820, 1180, 2],
    desktop: [1280, 800, 1],
};

/** `mobile`, `tablet`, `desktop` or `WIDTHxHEIGHT` (240 to 3840 each), as `set viewport` arguments. */
export function viewportArgs(given: unknown): string[] | undefined {
    if (typeof given !== "string") {
        return undefined;
    }

    const preset = VIEWPORTS[given.trim().toLowerCase()];
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(given.trim());
    const clamp = (value: number) => String(Math.min(3840, Math.max(240, value)));

    if (preset !== undefined) {
        return preset.map(String);
    }

    return match === null ? undefined : [clamp(Number(match[1])), clamp(Number(match[2])), "1"];
}

/** A ref as Pi writes it (`e12`, `[e12]`, `[ref=e12]`, `@e12`), as agent-browser takes it. */
export function refOf(given: string): string {
    return `@${given.replace(/^\[|\]$/g, "").replace(/^(ref=|@)/, "")}`;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

const clip = (text: string, max = MAX_TEXT): string =>
    text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;

function required<T>(value: T | undefined, action: string, what: string): T {
    if (value === undefined) {
        throw new Error(`${action} needs ${what}.`);
    }

    return value;
}

const WHERE =
    "JSON.stringify([location.href, document.title, innerWidth, innerHeight, devicePixelRatio])";

/** Statements that use `return` or top-level `await` run as an async function body, as extensions/browser does. */
export async function evaluate(
    session: string,
    script: string,
    signal?: AbortSignal,
): Promise<string> {
    const once = (code: string) =>
        run(session, ["eval", "-b", Buffer.from(code).toString("base64")], {
            ...(signal === undefined ? {} : { signal }),
        });
    let data: Record<string, unknown>;

    try {
        data = await once(script);
    } catch (error) {
        if (!/Illegal return statement|await is only valid/.test(messageOf(error))) {
            throw error;
        }

        data = await once(`(async () => {\n${script}\n})()`);
    }

    const result = data["result"];

    return result === undefined
        ? "undefined"
        : typeof result === "string"
          ? result
          : JSON.stringify(result);
}

export default function createAgentBrowser(host: Host) {
    const used = new Set<number>();

    host.onSessionGone((id) => {
        if (used.delete(id)) {
            void run(sessionOf(id), ["close"]).catch(() => {});
        }
    });

    const browser = defineTool({
        name: "browser",
        description:
            "Use a real web browser (Chromium on this machine) that the person watches live. Open pages (local dev servers, files, sites), read them as a snapshot with element refs, click, type, take screenshots you can see, read console errors, and run JavaScript in the page.",
        parameters: obj(
            {
                action: union(
                    ACTIONS.map((action) => lit(action)),
                    {
                        description:
                            "navigate (url), snapshot, screenshot, click/hover (ref, selector, label, or x and y), type (text into ref/selector/label, or the focused element), press (key), select (value in a select element), scroll (to ref/selector, or by dy), wait (text, selector, or timeoutMs), evaluate (script), console, back, forward, reload, viewport.",
                    },
                ),
                url: opt(
                    str({
                        description:
                            "navigate: an http(s) URL, host:port such as localhost:5173, or a path to an HTML file on this machine.",
                    }),
                ),
                ref: opt(
                    str({ description: "An element ref from the last snapshot, such as e12." }),
                ),
                selector: opt(
                    str({
                        description:
                            "Instead of ref: a CSS selector. wait: wait until it is visible.",
                    }),
                ),
                label: opt(
                    str({
                        description:
                            "Instead of ref: the element's visible text or label, such as a button's text.",
                    }),
                ),
                x: opt(
                    num({
                        description:
                            "click, hover: a point in CSS pixels of the viewport, as seen in a screenshot (one at a device scale above 1 says so).",
                    }),
                ),
                y: opt(num()),
                text: opt(
                    str({
                        description:
                            "type: the text to type (empty clears the field). wait: text to wait for.",
                    }),
                ),
                submit: opt(bool({ description: "type: press Enter afterwards." })),
                append: opt(
                    bool({
                        description: "type: add to what the field holds instead of replacing it.",
                    }),
                ),
                key: opt(
                    str({
                        description:
                            "press: a key or combination, such as Enter, Escape, Tab, ArrowDown, Control+A.",
                    }),
                ),
                value: opt(str({ description: "select: the option's value or text." })),
                dy: opt(
                    num({
                        description:
                            "scroll: pixels down (negative: up). Default: most of a screen down.",
                    }),
                ),
                script: opt(
                    str({
                        description:
                            "evaluate: JavaScript run in the page: an expression or statements (top-level await works), or a body that ends with return. Its value comes back as JSON.",
                    }),
                ),
                viewport: opt(
                    str({
                        description:
                            "viewport: mobile (390×844), tablet (820×1180), desktop (1280×800), or WIDTHxHEIGHT.",
                    }),
                ),
                fullPage: opt(
                    bool({
                        description: "screenshot: the whole page, not only what fits the viewport.",
                    }),
                ),
                timeoutMs: opt(
                    num({
                        description:
                            "navigate, wait: how long to wait in milliseconds (default 30000 for navigate, 10000 for wait).",
                    }),
                ),
                snapshot: opt(
                    bool({
                        description:
                            "After an action that changes the page: also return its snapshot.",
                    }),
                ),
                clear: opt(bool({ description: "console: clear the lines after reading them." })),
            },
            { open: true },
        ),
        // Pages are shared and stateful: a round's calls run in order.
        executionMode: "sequential",
        execute: async (args, api, context) => {
            const action: ToolAction = args.action;
            const id = Number(api.conversationId);
            const session = sessionOf(id);
            const signal = context.abortSignal;
            const sig = signal === undefined ? {} : { signal };
            const cli = (command: string[], timeoutMs?: number) =>
                run(session, command, {
                    ...sig,
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                });
            const agent = await api.snapshot(AgentDoc, api.conversationId, context);
            const cwd = agent?.cwd ?? process.cwd();
            const selector = args.ref === undefined ? args.selector : refOf(args.ref);
            const point =
                args.x === undefined || args.y === undefined
                    ? undefined
                    : [String(Math.round(args.x)), String(Math.round(args.y))];
            const lines: string[] = [];
            let image: string | undefined;
            let failed = false;
            const pointed = (): void => {
                if (selector === undefined && args.label === undefined && point === undefined) {
                    throw new Error(`${action} needs a ref, selector, label, or x and y.`);
                }
            };

            used.add(id);

            switch (action) {
                case "navigate": {
                    const given = required(args.url, action, "a url");
                    const url = normalizeUrl(given, { trusted: true, cwd });

                    if (url === undefined) {
                        throw new Error(
                            `"${given}" is not an address the browser opens: give an http(s) URL, host:port, or a file path.`,
                        );
                    }

                    try {
                        await cli(["open", url], args.timeoutMs ?? 30_000);
                        lines.push(`Opened ${url}.`);
                    } catch (error) {
                        failed = true;
                        const refused = messageOf(error).includes("CONNECTION_REFUSED");

                        lines.push(
                            `Could not open ${url}: ${messageOf(error)}.${refused ? " Nothing answers there: is the server running?" : ""}`,
                        );
                    }

                    break;
                }

                case "back":
                case "forward":
                case "reload":
                    await cli([action]);
                    lines.push(action === "reload" ? "Reloaded." : `Went ${action}.`);
                    break;

                case "snapshot":
                    break;

                case "screenshot": {
                    const folder = join(host.dataDir, "agent-browser");
                    const file = join(folder, `shot-${id}-${Date.now()}.jpg`);

                    await mkdir(folder, { recursive: true });

                    try {
                        await cli([
                            "screenshot",
                            ...(args.fullPage === true ? ["--full"] : []),
                            file,
                            "--screenshot-format",
                            "jpeg",
                            "--screenshot-quality",
                            "80",
                        ]);
                        image = (await readFile(file)).toString("base64");
                    } finally {
                        await rm(file, { force: true });
                    }

                    lines.push(
                        `Screenshot of ${args.fullPage === true ? "the whole page" : "the viewport"}.`,
                    );
                    break;
                }

                case "click":
                case "hover": {
                    pointed();

                    if (selector !== undefined) {
                        await cli([action, selector]);
                    } else if (args.label !== undefined) {
                        await cli(["find", "text", args.label, action]);
                    } else if (point !== undefined) {
                        await cli(["mouse", "move", ...point]);

                        if (action === "click") {
                            await cli(["mouse", "down"]);
                            await cli(["mouse", "up"]);
                        }
                    }

                    lines.push(
                        `${action === "click" ? "Clicked" : "The mouse is over"} ${selector ?? args.label ?? point?.join(",")}.`,
                    );
                    break;
                }

                case "type": {
                    const text = required(args.text, action, "text");

                    if (selector !== undefined) {
                        await cli([args.append === true ? "type" : "fill", selector, text]);
                    } else if (args.label !== undefined) {
                        await cli(["find", "label", args.label, "fill", text]);
                    } else {
                        await cli(["keyboard", "type", text]);
                    }

                    if (args.submit === true) {
                        await cli(["press", "Enter"]);
                    }

                    const into = selector ?? args.label ?? "the focused element";

                    lines.push(
                        text === ""
                            ? `Cleared ${into}.`
                            : `Typed into ${into}${args.submit === true ? " and pressed Enter" : ""}.`,
                    );
                    break;
                }

                case "press": {
                    const key = required(args.key, action, "a key");

                    await cli(["press", key]);
                    lines.push(`Pressed ${key}.`);
                    break;
                }

                case "select": {
                    const value = required(args.value, action, "a value");

                    await cli(["select", required(selector, action, "a ref or selector"), value]);
                    lines.push(`Selected "${value}".`);
                    break;
                }

                case "scroll":
                    if (selector !== undefined) {
                        await cli(["scrollintoview", selector]);
                        lines.push(`Scrolled to ${selector}.`);
                    } else {
                        const dy = args.dy ?? 600;

                        await cli(["scroll", dy < 0 ? "up" : "down", String(Math.abs(dy))]);
                        lines.push(`Scrolled ${dy < 0 ? "up" : "down"} ${Math.abs(dy)}px.`);
                    }

                    break;

                case "wait": {
                    const what = args.text === undefined ? args.selector : `"${args.text}"`;

                    const timeoutMs = args.timeoutMs ?? 10_000;
                    const limit = ["--timeout", String(timeoutMs)];

                    try {
                        if (args.text !== undefined) {
                            await cli(["wait", "--text", args.text, ...limit], timeoutMs + 5000);
                        } else if (args.selector !== undefined) {
                            await cli(["wait", args.selector, ...limit], timeoutMs + 5000);
                        } else {
                            await cli(["wait", String(timeoutMs)], timeoutMs + 5000);
                        }

                        lines.push(what === undefined ? "Waited." : `Found ${what}.`);
                    } catch (error) {
                        failed = true;
                        lines.push(
                            `${what ?? "The wait"} did not show up in time: ${messageOf(error)}`,
                        );
                    }

                    break;
                }

                case "evaluate":
                    lines.push(
                        clip(
                            await evaluate(
                                session,
                                required(args.script, action, "a script"),
                                signal,
                            ),
                        ),
                    );
                    break;

                case "console": {
                    const messages = (await cli(["console"]))["messages"];
                    const entries = Array.isArray(messages) ? messages.map(recordOf) : [];

                    // `console --clear` empties the buffer without printing it: read first.
                    if (args.clear === true) {
                        await cli(["console", "--clear"]);
                    }

                    lines.push(
                        entries.length === 0
                            ? "The console is empty."
                            : clip(
                                  entries
                                      .map(
                                          (entry) =>
                                              `[${String(entry?.["type"])}] ${String(entry?.["text"])}`,
                                      )
                                      .join("\n"),
                              ),
                    );
                    break;
                }

                case "viewport": {
                    const size = viewportArgs(args.viewport);

                    if (size === undefined) {
                        throw new Error("viewport needs mobile, tablet, desktop, or WIDTHxHEIGHT.");
                    }

                    await cli(["set", "viewport", ...size]);
                    lines.push(`The page is now ${size[0]}×${size[1]}.`);
                    break;
                }
            }

            if (action === "snapshot" || (args.snapshot === true && CHANGING.has(action))) {
                const outline = textOf((await cli(["snapshot", "-c"]))["snapshot"]);

                lines.push("Snapshot:", outline === "" ? "(no text or controls)" : clip(outline));
            }

            const parsed: unknown = JSON.parse(await evaluate(session, WHERE, signal));
            const [url, title, width, height, scale] = Array.isArray(parsed)
                ? parsed.map(String)
                : [];

            lines.push(
                `Page: ${title === "" || title === undefined ? "" : `"${title}" · `}${url === "about:blank" ? "a blank page" : url} · ${width}×${height}${scale === "1" ? "" : `, device scale ${scale}: a screenshot's pixels are CSS pixels × ${scale}`}`,
            );

            return {
                output: [
                    { type: "text" as const, text: lines.join("\n") },
                    ...(image === undefined
                        ? []
                        : [{ type: "image" as const, data: image, mimeType: "image/jpeg" }]),
                ],
                ...(failed ? { isError: true } : {}),
                details: {
                    action,
                    url: url ?? "",
                    address: displayUrl(url ?? ""),
                    title: title ?? "",
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

export const actions = (host: Host): Record<string, Action> => {
    const idOf = ({ session }: Parameters<Action>[0]): number => {
        if (session === null) {
            throw new ActionError("the browser belongs to a session");
        }

        return session.id;
    };
    const readable = async <T>(work: Promise<T>): Promise<T> => {
        try {
            return await work;
        } catch (error) {
            throw new ActionError(messageOf(error));
        }
    };

    return {
        /** The session's stream port; asking starts its daemon, not its Chrome. */
        async stream(call) {
            const data = await readable(run(sessionOf(idOf(call)), ["stream", "status"]));

            return { port: Number(data["port"]) || null, connected: data["connected"] === true };
        },

        /** What a person does from the toolbar: open, go somewhere, back, forward, reload, resize. */
        async control(call) {
            const session = sessionOf(idOf(call));
            const args = recordOf(call.args);
            const op = args?.["op"];

            if (op === "open") {
                await readable(run(session, ["open"]));
            } else if (op === "navigate") {
                const url = normalizeUrl(textOf(args?.["url"]), {
                    trusted: true,
                    cwd: call.session?.cwd ?? host.cwd,
                });

                if (url === undefined) {
                    throw new ActionError(
                        "That is not an address: try localhost:5173, example.com, or a file path.",
                    );
                }

                await readable(run(session, ["open", url]));
            } else if (op === "back" || op === "forward" || op === "reload") {
                await readable(run(session, [op]));
            } else if (op === "viewport") {
                const size = viewportArgs(args?.["viewport"]);

                if (size === undefined) {
                    throw new ActionError(
                        "Say mobile, tablet, desktop, or a size such as 1024x768.",
                    );
                }

                await readable(run(session, ["set", "viewport", ...size]));
            } else {
                throw new ActionError("unknown browser operation");
            }

            return true;
        },
    };
};
