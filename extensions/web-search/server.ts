/**
 * Web search: one tool, `web_search`, that asks a model with a built-in search tool and returns its
 * answer with numbered sources. It runs on a subscription the user already pays for, in this order:
 * ChatGPT, Claude, Kiro. A provider with no login, or whose call fails, hands over to the next.
 */

import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "typebox";

import type { Host, ResolveModelAuth } from "../../server/sdk.ts";
import { searchAnthropic } from "./anthropic.ts";
import { buildPrompt, formatAnswer, runChain, type Provider } from "./chain.ts";
import { searchChatgpt } from "./chatgpt.ts";
import { searchKiro } from "./kiro.ts";

export const meta = {
    title: "Web search",
    description: "Searches the web through your ChatGPT, Claude or Kiro subscription.",
};

/** What the tool takes: one question, or several angles asked as one prompt, plus pages to read. */
export type SearchArgs = {
    readonly query?: string;
    readonly queries?: readonly string[];
    readonly urls?: readonly string[];
};

const MAX_QUERIES = 5;

function providersOf(resolveAuth: ResolveModelAuth): Provider[] {
    return [
        {
            name: "chatgpt",
            timeoutMs: 60_000,
            search: (ask, signal) => searchChatgpt(resolveAuth, buildPrompt(ask, false), signal),
        },
        {
            name: "anthropic",
            timeoutMs: 60_000,
            search: (ask, signal) => searchAnthropic(resolveAuth, buildPrompt(ask, false), signal),
        },
        {
            name: "kiro",
            timeoutMs: 90_000,
            // Kiro answers in plain text, so its sources are asked for as a closing list.
            search: (ask, signal) => searchKiro(buildPrompt(ask, true), signal),
        },
    ];
}

export async function searchAnswer(
    resolveAuth: ResolveModelAuth,
    args: SearchArgs,
    signal: AbortSignal,
): Promise<ToolExecutionResult> {
    const text = (line: string, isError = false) => ({
        output: [{ type: "text" as const, text: line }],
        ...(isError ? { isError } : {}),
    });
    const urls = args.urls ?? [];
    const bad = urls.find((url) => !/^https?:\/\//i.test(url) || !URL.canParse(url));

    if (bad !== undefined) {
        return text(`urls must be http(s) links: ${bad.slice(0, 100)}`, true);
    }

    const queries = [...(args.query === undefined ? [] : [args.query]), ...(args.queries ?? [])]
        .map((query) => query.trim())
        .filter((query, index, all) => query !== "" && all.indexOf(query) === index);

    if (queries.length === 0) {
        return text("give query or queries", true);
    }

    // The schema caps `queries` alone; a call carrying both can still merge past it.
    if (queries.length > MAX_QUERIES) {
        return text(`at most ${MAX_QUERIES} queries`, true);
    }

    const outcome = await runChain(providersOf(resolveAuth), { queries, urls }, signal);

    if (outcome.kind === "answered") {
        return text(formatAnswer(outcome));
    }

    return outcome.kind === "aborted"
        ? text("Web search was stopped.", true)
        : text(`Web search failed.\n${outcome.reasons.join("\n")}`, true);
}

export default function webSearch(host: Host) {
    const webSearchTool = defineTool({
        name: "web_search",
        description:
            "Search the web and get back a synthesized answer with numbered source links, not raw result pages. Use it for current facts, versions, news and documentation. Give query or queries. Several queries cover several angles in one search. Give urls to have specific pages read as well.",
        parameters: Type.Object({
            query: Type.Optional(
                Type.String({
                    minLength: 1,
                    description: "What to find out, as a question or a topic.",
                }),
            ),
            queries: Type.Optional(
                Type.Array(Type.String({ minLength: 1 }), {
                    minItems: 1,
                    maxItems: MAX_QUERIES,
                    description:
                        "Several angles to ask at once, when one question would cover only part of what is needed. Searched as one prompt, not as separate searches.",
                }),
            ),
            urls: Type.Optional(
                Type.Array(Type.String(), {
                    maxItems: 20,
                    description: "Extra http(s) pages to read alongside the search.",
                }),
            ),
        }),
        execute: (args, _api, context) =>
            searchAnswer(
                host.resolveModelAuth,
                args,
                context.abortSignal ?? new AbortController().signal,
            ),
    });

    return defineExtension({ name: host.name, tools: [webSearchTool] });
}
