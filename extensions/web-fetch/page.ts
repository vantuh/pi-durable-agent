/**
 * One page, fetched and turned into Markdown. Kept apart from the tool so its tests can aim it at a
 * local server.
 *
 * The HTML path (linkedom → Readability → Turndown) is ported from Nico Bailon's pi-web-access,
 * `extract.ts`: MIT, © 2025 Nico Bailon.
 *
 * There is no SSRF guard, on purpose: the agent already has bash and curl on this machine, so
 * refusing private addresses here would protect nothing it cannot reach anyway.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

/** How much Markdown one call returns; the tool pages with `offset` beyond it. */
export const MAX_CHARS = 40_000;

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ACCEPT = "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8";

export type Page = { kind: "page"; url: string; title: string; markdown: string };
export type Fetched = Page | { kind: "error"; message: string };

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe"]);

const error = (message: string): Fetched => ({ kind: "error", message });

export async function fetchPage(url: string, signal?: AbortSignal): Promise<Fetched> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("timeout")), TIMEOUT_MS);
    const aborted =
        signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]);

    try {
        const response = await fetch(url, {
            redirect: "follow",
            headers: { "user-agent": USER_AGENT, accept: ACCEPT },
            signal: aborted,
        });

        if (!response.ok) {
            return error(`HTTP ${response.status}`);
        }

        const type =
            (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const isHtml = type === "text/html" || type === "application/xhtml+xml";
        // A page served without a content type is read as text rather than refused.
        const isText = type === "" || isHtml || type.startsWith("text/");

        if (!isText && type !== "application/json") {
            return error(`unsupported content type: ${type}`);
        }

        const body = response.body === null ? new Uint8Array() : await readBody(response.body);
        if (body === undefined) {
            return error("page too large: over 5 MiB");
        }

        const text = new TextDecoder().decode(body);
        const finalUrl = response.url === "" ? url : response.url;
        const converted = isHtml ? fromHtml(text, finalUrl) : { title: "", markdown: text };

        return {
            kind: "page",
            url: finalUrl,
            title: converted.title,
            markdown: collapse(converted.markdown),
        };
    } catch (cause) {
        if (signal?.aborted === true) {
            return error("web_fetch was stopped.");
        }
        if (timeout.signal.aborted) {
            return error(`the page did not answer within ${TIMEOUT_MS / 1000} seconds`);
        }
        return error(`fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
        clearTimeout(timer);
    }
}

/** The header, then the Markdown from `offset`. An offset past the end is an error, not empty text. */
export function format(page: Page, offset: number): { text: string; isError?: boolean } {
    const total = page.markdown.length;

    if (offset >= total) {
        return {
            text: `The page has ${total} characters, so offset ${offset} is past the end.`,
            isError: true,
        };
    }

    const end = Math.min(offset + MAX_CHARS, total);
    const title = page.title === "" ? "" : `# ${page.title}\n`;
    const note =
        end < total
            ? `\n\n[Truncated: showing characters ${offset}–${end} of ${total}. Call web_fetch again with offset: ${end} for more.]`
            : "";

    return { text: `${title}URL: ${page.url}\n\n${page.markdown.slice(offset, end)}${note}` };
}

/** The body, or undefined once it passes the cap: reading stops there instead of buffering the rest. */
async function readBody(body: ReadableStream<Uint8Array>): Promise<Uint8Array | undefined> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            return Buffer.concat(chunks, size);
        }
        size += value.length;
        if (size > MAX_BYTES) {
            await reader.cancel();
            return undefined;
        }
        chunks.push(value);
    }
}

function fromHtml(html: string, base: string): { title: string; markdown: string } {
    const { document } = parseHTML(html);
    absolutize(document, base);

    const article = new Readability(document).parse();

    if (typeof article?.content === "string" && article.content !== "") {
        return { title: article.title?.trim() ?? "", markdown: turndown.turndown(article.content) };
    }

    for (const element of document.querySelectorAll("nav, header, footer, aside, script, style")) {
        element.remove();
    }
    return { title: document.title.trim(), markdown: turndown.turndown(document.body.innerHTML) };
}

/** Readability resolves only what it keeps, so links are made absolute before it looks at the page. */
function absolutize(document: Document, base: string): void {
    for (const element of document.querySelectorAll("a[href], img[src]")) {
        for (const attribute of ["href", "src"]) {
            const value = element.getAttribute(attribute);
            if (value === null) {
                continue;
            }
            try {
                element.setAttribute(attribute, new URL(value, base).href);
            } catch {
                // A malformed link stays as the page wrote it.
            }
        }
    }
}

const collapse = (markdown: string): string => markdown.replace(/\n{3,}/g, "\n\n").trim();
