import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Gzip } from "node:zlib";

import { openEventStream, writeEvent } from "../server/http.ts";
import { listen } from "./fixtures/serve.ts";

type Sent = { response: ServerResponse; gzip: Gzip | undefined };

void describe("writeEvent", () => {
    void it("closes a stream whose reader stopped reading, instead of buffering for it", async () => {
        const chunk = `data: ${"x".repeat(100_000)}\n\n`;
        let opened: (response: ServerResponse) => void = () => undefined;
        const streamed = new Promise<ServerResponse>((done) => {
            opened = done;
        });
        const server = createServer((_request, response) => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            opened(response);
        });

        const { port, close } = await listen(server);
        const reader = connect(port, "127.0.0.1");

        reader.write("GET / HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n");
        reader.pause();

        try {
            const stream = await streamed;

            // Far more than any socket buffer holds: only an unread stream keeps it.
            for (let sent = 0; sent < 500 && !stream.destroyed; sent += 1) {
                writeEvent(stream, chunk);
                await delay(1);
            }

            assert.equal(stream.destroyed, true);
            assert.ok(stream.writableLength <= 1_100_000, String(stream.writableLength));
        } finally {
            reader.destroy();
            await close();
        }
    });

    void it("keeps the guard through the gzip stream, closing a reader that stopped", async () => {
        // Random bytes do not compress: the wire, not the compressor, is what fills up.
        const chunk = `data: ${randomBytes(75_000).toString("base64")}\n\n`;
        let opened: (stream: Sent) => void = () => undefined;
        const streamed = new Promise<Sent>((done) => {
            opened = done;
        });
        const server = createServer((request, response) => {
            opened({ response, gzip: openEventStream(request, response) });
        });

        const { port, close } = await listen(server);
        const reader = connect(port, "127.0.0.1");

        reader.write("GET / HTTP/1.1\r\nhost: 127.0.0.1\r\naccept-encoding: gzip\r\n\r\n");
        reader.pause();

        try {
            const stream = await streamed;

            assert.notEqual(stream.gzip, undefined, "the client took gzip");

            for (let sent = 0; sent < 500 && !stream.response.destroyed; sent += 1) {
                writeEvent(stream.response, chunk, stream.gzip);
                await delay(1);
            }

            assert.equal(stream.response.destroyed, true);
            assert.ok(
                stream.response.writableLength + (stream.gzip?.writableLength ?? 0) <= 1_100_000,
                String(stream.response.writableLength),
            );
        } finally {
            reader.destroy();
            await close();
        }
    });
});
