import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";

import { startServer, type TestServer } from "./fixtures/server.ts";

/** Past `MAX_BODY` in `server/http.ts`. */
const TOO_BIG = Buffer.alloc(100_000_001);

let server: TestServer;

before(async () => {
    server = await startServer();
});

after(async () => {
    await server.stop();
});

void describe("a body the server refuses", () => {
    void it("answers an upload past the limit with 413, sent whole or in chunks", async () => {
        const whole = await fetch(`${server.base}/api/files`, { method: "POST", body: TOO_BIG });

        assert.equal(whole.status, 413);
        assert.deepEqual(await whole.json(), { error: "body is too large" });

        // A write before `end` leaves out the length: the body is sent in chunks.
        const chunked = await new Promise<{ status: number | undefined; text: string }>(
            (done, fail) => {
                const request = httpRequest(
                    `${server.base}/api/files`,
                    { method: "POST" },
                    (response) => {
                        let text = "";

                        response.setEncoding("utf8");
                        response.on("data", (piece: string) => {
                            text += piece;
                        });
                        response.on("end", () => {
                            done({ status: response.statusCode, text });
                        });
                    },
                );

                request.on("error", fail);
                request.write(TOO_BIG);
                request.end();
            },
        );

        assert.equal(chunked.status, 413);
        assert.deepEqual(JSON.parse(chunked.text), { error: "body is too large" });
    });

    void it("answers a body that is not JSON with 400", async () => {
        const response = await fetch(`${server.base}/api/sessions/title`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{oops",
        });

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: "body is not JSON" });
    });
});
