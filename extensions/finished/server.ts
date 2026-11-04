/** Tells you a run ended: the browser does it, so this half only installs the extension. */

import { defineExtension } from "@earendil-works/pi-durable";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Finished runs",
    description:
        "A chime when a run ends, and a toast when another session's run ends; a click on the toast opens that session.",
};

export default function finished(host: Host) {
    return defineExtension({ name: host.name });
}
