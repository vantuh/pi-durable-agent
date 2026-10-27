import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";

/**
 * Blocks DNS rebinding: a rebound page reaches us under its own domain name. An IP address cannot be
 * rebound, and `*.ts.net` names belong to Tailscale, so those, and `localhost`, are the only hosts.
 */
export function knownHost(host: string | undefined): boolean {
    if (host === undefined) {
        return false;
    }

    let name: string;

    try {
        name = new URL(`http://${host}`).hostname;
    } catch {
        return false;
    }

    return (
        isIP(name.replace(/^\[|\]$/g, "")) !== 0 || name === "localhost" || name.endsWith(".ts.net")
    );
}

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
