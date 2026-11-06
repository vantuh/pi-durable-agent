/**
 * Reading a request's input through Zod: a JSON body and a query string. A route that fails the check answers
 * 400 with the one sentence it has always used; its handler reads the checked input from `c.req.valid(...)`.
 */

import { zValidator } from "@hono/zod-validator";
import type { Context, MiddlewareHandler, TypedResponse } from "hono";
import { z } from "zod";

import { isRecord } from "../shared/guards.ts";
import { type ApiEnv, readJson } from "./http.ts";

/** An id (of a session, an entry, a queued input) is a positive safe integer. */
export const PositiveId = z.int().positive();

/** A number in a query string, as `Number(text)` reads it; what is no number fails the check that follows. */
export const QueryNumber = z.string().transform(Number);

/**
 * A field the route reads when it can and ignores when it cannot: a value of the wrong type is as good as none.
 * Most routes always did this, and a body that worked then should work now.
 */
export function lenient<T extends z.ZodType>(schema: T) {
    return schema.optional().catch(undefined);
}

/** The strings of a list, and nothing for any other value. `default` keeps the field optional for `hc`. */
export const StringList = z
    .array(z.unknown())
    .default([])
    .transform((items) => items.filter((item) => typeof item === "string"))
    .catch([]);

/**
 * The sentence a refusal answers with: one for the whole input, or one chosen by the path of the first field
 * that failed.
 */
export type Message = string | ((path: readonly PropertyKey[]) => string);

function sentenceOf(error: z.core.$ZodError, message: Message): string {
    return typeof message === "string" ? message : message(error.issues[0]?.path ?? []);
}

/** What a refused request answers; `hc` reads it as the 400 of the route. */
export type Refusal = Response & TypedResponse<{ error: string }, 400, "json">;

type JsonInput<T extends z.ZodType<object>> = {
    in: { json: z.input<T> };
    out: { json: z.output<T> };
};

/**
 * Reads the JSON body and checks it against `schema`. Not Hono's JSON validator, which needs a JSON
 * `Content-Type` and refuses an empty body: a route here takes a body without either, as it always did, and
 * `readJson` keeps the size limit (413) and the answer to a body that is not JSON (400).
 *
 * An empty body, and by default any body that is not an object, is read as `{}`; `whole` hands the schema a
 * body that is not an object as it is, for the route that refuses one.
 *
 * The session the body names is what the list refreshes after the request (`changedSession`), whether or not
 * the rest of the body passes: a request the check refuses changed nothing, and a refresh of one row is cheap.
 * `marksSession: false` is for a route whose body names a session without changing its row: an extension's.
 */
export function jsonBody<T extends z.ZodType<object>, P extends string = string>(
    schema: T,
    message: Message = "The body is not valid",
    { whole = false, marksSession = true }: { whole?: boolean; marksSession?: boolean } = {},
): MiddlewareHandler<ApiEnv, P, JsonInput<T>, Refusal> {
    return async (c, next) => {
        const sent = await readJson(c.env.incoming);

        if (marksSession) {
            c.set(
                "changedSession",
                PositiveId.safeParse(isRecord(sent) ? sent["session"] : undefined).data,
            );
        }

        const result = await schema.safeParseAsync(
            isRecord(sent) || (whole && sent !== undefined) ? sent : {},
        );

        if (!result.success) {
            return c.json({ error: sentenceOf(result.error, message) }, 400);
        }

        c.req.addValidatedData("json", result.data);
        return await next();
    };
}

/**
 * Checks the query string against `schema`, and the handler reads the result from `c.req.valid("query")`. A
 * field is what the browser sends, a string: a number is `z.coerce.number()`. A key sent twice is an array,
 * which fails a string field; `c.req.query(key)` used to give its first value.
 */
export function queryOf<T extends z.ZodType>(
    schema: T,
    message: Message = "The query is not valid",
) {
    return zValidator(
        "query",
        schema,
        (result: { success: true } | { success: false; error: z.core.$ZodError }, c: Context) => {
            if (!result.success) {
                return c.json({ error: sentenceOf(result.error, message) }, 400);
            }

            return undefined;
        },
    );
}
