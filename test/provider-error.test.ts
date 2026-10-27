import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readProviderError } from "../web/src/lib/provider-error.ts";

void describe("readProviderError", () => {
    void it("pulls the message, kind and request id out of a provider body", () => {
        const raw =
            '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_1"}';
        assert.deepEqual(readProviderError(raw), {
            title: "Overloaded",
            detail: "overloaded_error",
            requestId: "req_1",
        });
    });

    void it("keeps a status prefix", () => {
        const raw = '529 {"error":{"type":"overloaded_error","message":"Overloaded"}}';
        assert.deepEqual(readProviderError(raw), {
            title: "Overloaded",
            detail: "529 · overloaded_error",
        });
    });

    void it("leaves plain text alone", () => {
        assert.deepEqual(readProviderError("fetch failed"), { title: "fetch failed" });
        assert.deepEqual(readProviderError("{broken"), { title: "{broken" });
    });
});
