/**
 * Web search: one tool, `web_search`, that asks a model with a built-in search tool and returns its
 * answer with numbered sources. It runs on a subscription the user already pays for, in this order:
 * ChatGPT, Claude, Kiro. A provider with no login, or whose call fails, hands over to the next.
 */

import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";

import type { Host } from "../../server/sdk.ts";
import { searchAnthropic } from "./anthropic.ts";
import { buildPrompt, formatAnswer, runChain, type Provider } from "./chain.ts";
import { searchChatgpt } from "./chatgpt.ts";
import { searchKiro } from "./kiro.ts";

export const meta = {
    title: "Web search",
    description: "Searches the web through your ChatGPT, Claude or Kiro subscription.",
};

function providersOf(host: Host): Provider[] {
    return [
        {
            name: "chatgpt",
            timeoutMs: 60_000,
            search: (ask, signal) =>
                searchChatgpt(host.resolveModelAuth, buildPrompt(ask, false), signal),
        },
        {
            name: "anthropic",
            timeoutMs: 60_000,
            search: (ask, signal) =>
                searchAnthropic(host.resolveModelAuth, buildPrompt(ask, false), signal),
        },
        {
            name: "kiro",
            timeoutMs: 90_000,
            // Kiro answers in plain text, so its sources are asked for as a closing list.
            search: (ask, signal) => searchKiro(buildPrompt(ask, true), signal),
        },
    ];
}

export default function webSearch(host: Host) {
    const webSearchTool = defineTool({
        name: "web_search",
        description:
            "Search the web and get back a synthesized answer with numbered source links, not raw result pages. Use it for current facts, versions, news and documentation. Give urls to have specific pages read as well.",
        parameters: Type.Object({
            query: Type.String({
                minLength: 1,
                description: "What to find out, as a question or a topic.",
            }),
            urls: Type.Optional(
                Type.Array(Type.String(), {
                    maxItems: 20,
                    description: "Extra http(s) pages to read alongside the search.",
                }),
            ),
        }),
        execute: async (args, _api, context) => {
            const text = (line: string, isError = false) => ({
                output: [{ type: "text" as const, text: line }],
                ...(isError ? { isError } : {}),
            });
            const urls = args.urls ?? [];
            const bad = urls.find((url) => !/^https?:\/\//i.test(url) || !URL.canParse(url));

            if (bad !== undefined) {
                return text(`urls must be http(s) links: ${bad.slice(0, 100)}`, true);
            }

            const outcome = await runChain(
                providersOf(host),
                { query: args.query, urls },
                context.abortSignal ?? new AbortController().signal,
            );

            if (outcome.kind === "answered") {
                return text(formatAnswer(outcome));
            }

            return outcome.kind === "aborted"
                ? text("Web search was stopped.", true)
                : text(`Web search failed.\n${outcome.reasons.join("\n")}`, true);
        },
    });

    return defineExtension({ name: host.name, tools: [webSearchTool] });
}
