/**
 * ChatGPT: the web search of the OpenAI Responses API, on the "Sign in with ChatGPT" login.
 *
 * Pi's `openai` login is a token for `api.openai.com/v1/responses` (it has no ChatGPT account id,
 * so the `chatgpt.com/backend-api/codex` route does not take it). Request shape ported from
 * pi-web-search (MIT, ttttmr) `src/providers/openai.ts` and pi-web-access (MIT, © 2025 Nico Bailon)
 * `openai-search.ts`.
 */

import type { ResolveModelAuth } from "../../server/sdk.ts";
import {
    type Found,
    type Source,
    sourceOf,
    httpError,
    list,
    parseSse,
    record,
    str,
    uniqueSources,
} from "./wire.ts";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MODEL = "gpt-6-luna";

/** OpenAI tags the links it cites with `utm_source=openai`; the reader does not need it. */
function clean(text: string): string {
    return text.replace(/\?utm_source=openai&/g, "?").replace(/[?&]utm_source=openai/g, "");
}

export function readResponses(body: string): Found {
    const messages: string[] = [];
    const cited: Source[] = [];
    const searched: Source[] = [];

    for (const event of parseSse(body)) {
        const { type, item, error, response } = record(event);

        if (type === "error" || type === "response.failed") {
            const detail = record(type === "error" ? error : record(response)["error"]);

            throw new Error(
                `stream error: ${str(detail["message"]) ?? "stream failed"}`.slice(0, 200),
            );
        }

        if (type !== "response.output_item.done") {
            continue;
        }

        const found = record(item);

        if (found["type"] === "web_search_call") {
            for (const source of list(record(found["action"])["sources"])) {
                const url = str(record(source)["url"]);

                if (url !== undefined) {
                    searched.push(sourceOf(clean(url)));
                }
            }
        }

        // A model that narrates its search sends that as a "commentary" message before the answer.
        const phase = str(found["phase"]);

        if (found["type"] !== "message" || (phase !== undefined && phase !== "final_answer")) {
            continue;
        }

        let message = "";

        for (const part of list(found["content"])) {
            const { type: partType, text, annotations } = record(part);

            if (partType !== "output_text") {
                continue;
            }

            message += str(text) ?? "";

            for (const annotation of list(annotations)) {
                const { type: kind, url, title } = record(annotation);
                const link = str(url);

                if (kind === "url_citation" && link !== undefined) {
                    cited.push(sourceOf(clean(link), title));
                }
            }
        }

        messages.push(message);
    }

    const answer = messages.filter((message) => message !== "").join("\n\n");

    if (answer === "") {
        throw new Error("the response had no answer");
    }

    return {
        answer: clean(answer),
        sources: uniqueSources(cited.length > 0 ? cited : searched),
        model: MODEL,
    };
}

export async function searchChatgpt(
    resolveAuth: ResolveModelAuth,
    prompt: string,
    signal: AbortSignal,
    fetchImpl: typeof fetch = fetch,
): Promise<Found> {
    const token = (await resolveAuth("openai", signal))?.apiKey;

    // An API key (sk-…) would bill the API, not the subscription.
    if (token === undefined || token.startsWith("sk-")) {
        throw new Error("not signed in with ChatGPT");
    }

    const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "text/event-stream",
        },
        body: JSON.stringify({
            model: MODEL,
            instructions:
                "Answer the user's request using web search. Be concise and cite sources.",
            input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
            tools: [{ type: "web_search" }],
            include: ["web_search_call.action.sources"],
            stream: true,
            store: false,
        }),
        signal,
    });

    if (!response.ok) {
        throw await httpError(response);
    }

    return readResponses(await response.text());
}
