import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";

import type { ImageContent, Message } from "@earendil-works/pi-ai";

import { beforeRequest } from "./server.ts";

const CRC = new Uint32Array(256);

for (let n = 0; n < 256; n += 1) {
    let value = n;

    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    CRC[n] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
    let value = 0xffffffff;

    for (const byte of bytes) {
        value = (CRC[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
    }

    return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const out = Buffer.alloc(12 + data.length);

    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);

    return out;
}

/** A real PNG of that size: a 24-bit gradient no encoder can reduce to nothing. */
function png(width: number, height: number): ImageContent {
    const header = Buffer.alloc(13);

    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per channel
    header[9] = 2; // truecolour

    const row = 1 + width * 3;
    const pixels = Buffer.alloc(height * row);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = y * row + 1 + x * 3;

            pixels[at] = (x * 7) & 0xff;
            pixels[at + 1] = (y * 11) & 0xff;
            pixels[at + 2] = (x ^ y) & 0xff;
        }
    }

    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = Buffer.concat([
        signature,
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(pixels)),
        chunk("IEND", Buffer.alloc(0)),
    ]);

    return { type: "image", data: payload.toString("base64"), mimeType: "image/png" };
}

/** The longest side, read from the payload's own header the way a provider would. */
function longestSide(image: ImageContent): number {
    const bytes = Buffer.from(image.data, "base64");

    if (image.mimeType === "image/png") {
        return Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    }

    if (image.mimeType === "image/jpeg") {
        let at = 2;

        while (at < bytes.length - 9) {
            const marker = bytes[at + 1];

            if (bytes[at] !== 0xff || marker === undefined) {
                at += 1;
                continue;
            }

            // SOF0..SOF15 carry the frame size; C4 holds tables, C8 is reserved and CC is arithmetic.
            if (
                marker >= 0xc0 &&
                marker <= 0xcf &&
                marker !== 0xc4 &&
                marker !== 0xc8 &&
                marker !== 0xcc
            ) {
                return Math.max(bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 7));
            }

            at += 2 + bytes.readUInt16BE(at + 2);
        }
    }

    throw new Error(`cannot read the size of a ${image.mimeType} image`);
}

function imageIn(message: Message | undefined): ImageContent {
    assert.ok(message?.role === "user" || message?.role === "toolResult");
    assert.ok(Array.isArray(message.content));

    const found = message.content.find((part): part is ImageContent => part.type === "image");

    assert.ok(found !== undefined);

    return found;
}

void describe("image-limit beforeRequest", () => {
    void it("shrinks an image the provider would refuse, and keeps the text beside it", async () => {
        const big = png(2100, 64);
        const text = { type: "text", text: "what is in this screenshot?" } as const;
        const message: Message = { role: "user", content: [text, big], timestamp: 0 };

        const request = await beforeRequest({ messages: [message] });

        assert.ok(request !== undefined);
        assert.equal(request.messages.length, 1);

        const shrunk = imageIn(request.messages[0]);

        assert.ok(longestSide(shrunk) <= 2000, `longest side is ${String(longestSide(shrunk))}`);
        assert.notEqual(shrunk.data, big.data);

        const kept = request.messages[0];

        assert.ok(kept?.role === "user");
        assert.deepEqual(kept.content[0], text);
        // The context the transcript holds is untouched: only this request sees the smaller image.
        assert.equal(imageIn(message).data, big.data);
    });

    void it("shrinks an image a tool returned", async () => {
        const big = png(64, 2100);
        const message: Message = {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "screenshot",
            content: [{ type: "text", text: "captured" }, big],
            isError: false,
            timestamp: 0,
        };

        const request = await beforeRequest({ messages: [message] });

        assert.ok(request !== undefined);
        assert.ok(longestSide(imageIn(request.messages[0])) <= 2000);
    });

    void it("leaves a small image alone", async () => {
        const message: Message = {
            role: "user",
            content: [png(800, 600)],
            timestamp: 0,
        };

        assert.equal(await beforeRequest({ messages: [message] }), undefined);
    });

    void it("leaves an image it cannot read alone, so nothing is dropped", async () => {
        const broken: ImageContent = {
            type: "image",
            mimeType: "image/png",
            data: Buffer.from("not a png at all").toString("base64"),
        };
        const message: Message = { role: "user", content: [broken], timestamp: 0 };

        assert.equal(await beforeRequest({ messages: [message] }), undefined);
    });

    void it("leaves a context without images alone", async () => {
        const messages: Message[] = [
            { role: "user", content: "no pictures here", timestamp: 0 },
            { role: "system", content: "no pictures here either", timestamp: 0 },
        ];

        assert.equal(await beforeRequest({ messages }), undefined);
    });

    void it("sends the same bytes for the same image on a later turn", async () => {
        const big = png(2100, 64);
        const twice = () =>
            beforeRequest({ messages: [{ role: "user", content: [big], timestamp: 0 }] });

        const first = await twice();
        const second = await twice();

        assert.ok(first !== undefined && second !== undefined);
        assert.equal(imageIn(first.messages[0]).data, imageIn(second.messages[0]).data);
    });
});
