import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Hono } from "hono";
import { z } from "zod";

import { type ApiEnv, routeFailed } from "../server/http.ts";
import { jsonBody, lenient, PositiveId } from "../server/validate.ts";
import { serve } from "./fixtures/serve.ts";

const Body = z.object({
    session: PositiveId.optional(),
    name: z.string(),
    note: lenient(z.string()),
});
const Whole = z.object({ name: z.string() });

/** An app that tells, after each request, which session it marked as changed. */
async function withApp() {
    const marked: (number | undefined)[] = [];
    const app = new Hono<ApiEnv>()
        .use("*", async (c, next) => {
            await next();
            marked.push(c.get("changedSession"));
        })
        .post("/named", jsonBody(Body, "Expected a name"), (c) => c.json(c.req.valid("json")))
        .post(
            "/by-field",
            jsonBody(Body, (path) => `bad ${String(path[0])}`),
            (c) => c.json(c.req.valid("json")),
        )
        .post("/whole", jsonBody(Whole, "Expected an object", { whole: true }), (c) =>
            c.json(c.req.valid("json")),
        )
        .get("/nothing", (c) => c.json({}))
        .onError(routeFailed);
    const server = await serve(app);

    const post = async (path: string, body?: string, type = "application/json") => {
        const response = await fetch(server.base + path, {
            method: "POST",
            headers: { "content-type": type },
            ...(body === undefined ? {} : { body }),
        });

        return { status: response.status, body: await response.json() };
    };

    return { marked, post, server };
}

void describe("jsonBody", () => {
    void it("hands the handler the checked body", async () => {
        const { post, server } = await withApp();

        try {
            assert.deepEqual(await post("/named", '{"name":"a","extra":1,"note":5}'), {
                status: 200,
                body: { name: "a" },
            });
        } finally {
            await server.close();
        }
    });

    void it("reads a body without a JSON content type, and an empty one as {}", async () => {
        const { post, server } = await withApp();

        try {
            assert.equal((await post("/named", '{"name":"a"}', "text/plain")).status, 200);
            assert.deepEqual(await post("/named"), {
                status: 400,
                body: { error: "Expected a name" },
            });
            assert.deepEqual(await post("/named", "[1]"), {
                status: 400,
                body: { error: "Expected a name" },
            });
        } finally {
            await server.close();
        }
    });

    void it("answers a refusal with the sentence for the first field that failed", async () => {
        const { post, server } = await withApp();

        try {
            assert.deepEqual(await post("/by-field", '{"session":"x","name":1}'), {
                status: 400,
                body: { error: "bad session" },
            });
            assert.deepEqual(await post("/by-field", '{"session":3,"name":1}'), {
                status: 400,
                body: { error: "bad name" },
            });
        } finally {
            await server.close();
        }
    });

    void it("hands a body that is not an object to the schema when asked to", async () => {
        const { post, server } = await withApp();

        try {
            assert.equal((await post("/whole", "{}")).status, 400);
            assert.equal((await post("/whole", '{"name":"a"}')).status, 200);
            assert.deepEqual(await post("/whole", "[]"), {
                status: 400,
                body: { error: "Expected an object" },
            });
        } finally {
            await server.close();
        }
    });

    void it("answers a body that is not JSON with 400", async () => {
        const { post, server } = await withApp();

        try {
            assert.deepEqual(await post("/named", "{oops"), {
                status: 400,
                body: { error: "body is not JSON" },
            });
        } finally {
            await server.close();
        }
    });

    void it("marks the session the body names as changed, checked or refused", async () => {
        const { marked, post, server } = await withApp();

        try {
            await post("/named", '{"session":7,"name":"a"}');
            await post("/named", '{"session":8}');
            await post("/named", '{"session":"9","name":"a"}');
            await post("/named", '{"session":0,"name":"a"}');
            await post("/named", "[]");
            await post("/named", "{oops");
            await fetch(`${server.base}/nothing`);

            // A session the schema refuses is not one the body named; a body that is not JSON names none.
            assert.deepEqual(marked, [7, 8, undefined, undefined, undefined, undefined, undefined]);
        } finally {
            await server.close();
        }
    });
});
