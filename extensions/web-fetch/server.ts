/**
 * Web fetch: one tool, `fetch_content`, that turns a web page into Markdown. It is the reading half
 * of `web_search`: the search answers a question, this opens the page.
 *
 * No private-address guard, deliberately: the agent already runs bash and curl on this machine, so
 * a check here would protect nothing. No PDF either — a binary needs a different reader.
 */

import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";

import type { Host } from "../../server/sdk.ts";
import { fetchPage, format } from "./page.ts";

export const meta = {
    title: "Web fetch",
    description: "Reads a web page as Markdown, one page at a time.",
};

const reply = (text: string, isError = false) => ({
    output: [{ type: "text" as const, text }],
    ...(isError ? { isError } : {}),
});

export default function webFetch(host: Host) {
    const webFetchTool = defineTool({
        name: "fetch_content",
        description:
            "Fetch one public page and return its main content as Markdown. A long page is cut short: call again with offset to read the rest. For current facts, use web_search first.",
        parameters: Type.Object({
            url: Type.String({
                minLength: 1,
                description: "The http(s) page to read.",
            }),
            offset: Type.Optional(
                Type.Integer({
                    minimum: 0,
                    description:
                        "Character offset into the Markdown, to continue a page that was truncated.",
                }),
            ),
        }),
        execute: async (args, _api, context) => {
            if (!/^https?:\/\//i.test(args.url) || !URL.canParse(args.url)) {
                return reply(`url must be an http(s) link: ${args.url.slice(0, 100)}`, true);
            }

            const page = await fetchPage(args.url, context.abortSignal);

            if (page.kind === "error") {
                return reply(page.message, true);
            }

            const { text, isError } = format(page, args.offset ?? 0);

            return reply(text, isError === true);
        },
    });

    return defineExtension({ name: host.name, tools: [webFetchTool] });
}
