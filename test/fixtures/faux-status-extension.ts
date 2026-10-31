// A test-only extension: one status field of the shape `extensions/cache-hit` returns, shown once an answer is
// committed and the same from then on, so a test can count how often a live frame repeats it.
import { defineExtension } from "@earendil-works/pi-durable";

import type { Host, StatusProvider } from "../../server/sdk.ts";

export const STATUS_TEXT = "62%";
export const STATUS_TITLE = `62% of the input came from the cache ${"over the answers still in the context ".repeat(2)}`;

export default function fauxStatusExtension(host: Host) {
    return defineExtension({ name: host.name });
}

export const status: StatusProvider = ({ entries }) =>
    entries.some((entry) => entry.kind === "pi.assistant")
        ? { slot: "composer", label: "cache", text: STATUS_TEXT, title: STATUS_TITLE }
        : undefined;
