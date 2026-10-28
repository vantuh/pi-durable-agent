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
            await discard(response);
            return error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
        const isHtml = type === "text/html" || type === "application/xhtml+xml";
        // A page served without a content type is read as text rather than refused.
        const isText = type === "" || isHtml || type.startsWith("text/");

        if (!isText && type !== "application/json") {
            await discard(response);
            return error(`unsupported content type: ${type}`);
        }

        const body = response.body === null ? new Uint8Array() : await readBody(response.body);
        if (body === undefined) {
            return error("page too large: over 5 MiB");
        }

        const text = decode(body, contentType, isHtml);
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
            return error("fetch_content was stopped.");
        }
        if (timeout.signal.aborted) {
            return error(`the page did not answer within ${TIMEOUT_MS / 1000} seconds`);
        }
        return error(`fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The header, then the Markdown from `offset`. An offset past the end is an error, not empty text; a
 * page with nothing to read at offset 0 says so instead.
 */
export function format(page: Page, offset: number): { text: string; isError?: boolean } {
    const total = page.markdown.length;
    const header = `${page.title === "" ? "" : `# ${page.title}\n`}URL: ${page.url}\n\n`;

    if (offset >= total) {
        if (offset === 0) {
            return { text: `${header}(the page has no readable text; it may need JavaScript)` };
        }
        return {
            text: `The page has ${total} characters, so offset ${offset} is past the end.`,
            isError: true,
        };
    }

    const start = isLowSurrogate(page.markdown.charCodeAt(offset)) ? offset - 1 : offset;
    let end = Math.min(offset + MAX_CHARS, total);
    // A slice that ends inside a surrogate pair cannot be printed; the pair waits for the next call.
    if (end < total && isHighSurrogate(page.markdown.charCodeAt(end - 1))) {
        end -= 1;
    }

    const note =
        end < total
            ? `\n\n[Truncated: showing characters ${offset}–${end} of ${total}. Call fetch_content again with offset: ${end} for more.]`
            : "";

    return { text: `${header}${page.markdown.slice(start, end)}${note}` };
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The body decoded with the charset the response names: a BOM first, then its Content-Type, then an
 * HTML `<meta>`, then UTF-8. A label TextDecoder does not know also falls back to UTF-8.
 */
function decode(body: Uint8Array, contentType: string, isHtml: boolean): string {
    const label = bomOf(body) ?? labelOf(contentType) ?? metaLabelOf(body, isHtml);

    if (label === undefined) {
        return new TextDecoder().decode(body);
    }

    try {
        return new TextDecoder(label).decode(body);
    } catch {
        return new TextDecoder().decode(body);
    }
}

/** A BOM outranks every declaration, as it does in a browser; TextDecoder then strips it for us. */
function bomOf(body: Uint8Array): string | undefined {
    const [first, second, third] = body;

    if (first === 0xef && second === 0xbb && third === 0xbf) {
        return "utf-8";
    }
    if (first === 0xff && second === 0xfe) {
        return "utf-16le";
    }
    if (first === 0xfe && second === 0xff) {
        return "utf-16be";
    }
    return undefined;
}

const labelOf = (source: string): string | undefined =>
    /charset\s*=\s*["']?([^"';,\s/>]+)/i.exec(source)?.[1];

/**
 * A `<meta>` label, with utf-16 and utf-32 read as UTF-8: an ASCII page cannot really be either, and
 * decoding it as one loses the whole document. Only a `<meta>` tag counts — prose may name a charset.
 */
function metaLabelOf(body: Uint8Array, isHtml: boolean): string | undefined {
    if (!isHtml) {
        return undefined;
    }

    const label = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>;]+)/i.exec(
        new TextDecoder("latin1").decode(body.subarray(0, 4096)),
    )?.[1];

    if (label === undefined) {
        return undefined;
    }
    return /utf-?16|utf-?32/i.test(label) ? "utf-8" : label;
}

/** Releases a response this call is not going to read, so its socket goes back to the pool. */
async function discard(response: Response): Promise<void> {
    if (response.body !== null) {
        await response.body.cancel();
    }
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
    unwrapDataImages(document);

    const documentTitle = collapseSpaces(document.title);
    const article = new Readability(document).parse();
    const content = article?.content ?? "";

    return {
        title: collapseSpaces(article?.title ?? "") || documentTitle,
        markdown: content === "" ? "" : turndown.turndown(content),
    };
}

/** An inline image is a page of base64 in Markdown; the alt text is the part worth keeping. */
function unwrapDataImages(document: Document): void {
    for (const image of document.querySelectorAll("img[src]")) {
        if (!(image.getAttribute("src") ?? "").toLowerCase().startsWith("data:")) {
            continue;
        }
        image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
    }
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

const collapseSpaces = (title: string): string => title.replace(/\s+/g, " ").trim();
