import assert from "node:assert/strict";
import { it } from "node:test";

import { knownHost } from "../server/same-origin.ts";

void it("accepts IP addresses, localhost and Tailscale names, and nothing a rebound domain can be", () => {
    for (const host of [
        "127.0.0.1:8788",
        "192.168.1.20:8788",
        "100.101.102.103",
        "[::1]:5190",
        "localhost:5190",
        "macbook.tail0911f8.ts.net:8443",
    ]) {
        assert.equal(knownHost(host), true, host);
    }

    for (const host of [
        undefined,
        "",
        "evil.example",
        "127.0.0.1.evil.example",
        "localhost.evil.example",
        "ts.net.evil.example",
        "evilts.net",
    ]) {
        assert.equal(knownHost(host), false, String(host));
    }
});
