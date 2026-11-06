/** The layout is drawn by the browser, so this half only installs the extension and lists it. */

import { defineExtension } from "@earendil-works/pi-durable";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Bash view",
    description:
        "A bash call's command as written, laid out one statement and chain part per line, or as a row per command with its icon.",
};

export default function bashView(host: Host) {
    return defineExtension({ name: host.name });
}
