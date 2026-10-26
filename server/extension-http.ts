import type { IncomingHttpHeaders } from "node:http";

/** Raw local-process HTTP must not accept a browser from another origin/site. */
export function extensionHttpAllowed(headers: IncomingHttpHeaders): boolean {
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
