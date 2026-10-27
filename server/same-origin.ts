import type { IncomingHttpHeaders } from "node:http";

/** The API runs tools on this machine, so a page from another origin or site must not reach it. */
export function sameOrigin(headers: IncomingHttpHeaders): boolean {
    const site = headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") {
        return false;
    }
    if (headers.origin === undefined) {
        return true;
    }
    try {
        return new URL(headers.origin).host === headers.host;
    } catch {
        return false;
    }
}
