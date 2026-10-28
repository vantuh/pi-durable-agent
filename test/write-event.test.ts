import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { writeEvent } from "../server/http.ts";

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

        await new Promise<void>((done) => {
            server.listen(0, "127.0.0.1", done);
        });

        const address = server.address();

        assert.ok(address !== null && typeof address !== "string");

        const reader = connect(address.port, "127.0.0.1");

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
            server.closeAllConnections();
            await new Promise<void>((done) => {
                server.close(() => {
                    done();
                });
            });
        }
    });
});
