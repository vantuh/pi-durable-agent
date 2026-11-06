/** What both event streams share: an open response, one frame written to many of them, and the idle heartbeat. */

import type { ServerResponse } from "node:http";
import type { Gzip } from "node:zlib";

import type { ServerEvent, SessionsEvent } from "../../shared/protocol.ts";
import { writeEvent } from "../http.ts";

/** One open stream: the response, and the gzip stream its events go through for a client that takes one. */
export type EventStream = { response: ServerResponse; gzip: Gzip | undefined };

// A phone radio that wakes every 20 s never rests; 45 s still stays under the usual proxy idle timeouts.
export const IDLE_HEARTBEAT_MS = 45_000;

/** One frame, written once for every stream: one `writeEvent` per frame, so the gzip stream flushes it as it is. */
export function sendFrame(
    streams: Iterable<EventStream>,
    event: ServerEvent | SessionsEvent,
): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;

    for (const stream of streams) {
        writeEvent(stream.response, data, stream.gzip);
    }
}

/** A comment frame no client reads, so a connection that carries nothing for a while is not taken for dead. */
export function sendHeartbeat(streams: Iterable<EventStream>): void {
    for (const stream of streams) {
        writeEvent(stream.response, ": heartbeat\n\n", stream.gzip);
    }
}
