import { defineExtension } from "@earendil-works/pi-durable";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Dictation",
    description:
        "A mic beside Send that types what you say, with the browser's speech recognition.",
};

// The work is in `web.tsx`; this half only lets the owner switch it on and off.
export default function dictation(host: Host) {
    return defineExtension({ name: host.name });
}
