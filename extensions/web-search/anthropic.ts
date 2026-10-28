/**
 * Anthropic: the `web_search` server tool, on the Claude subscription (OAuth) login.
 *
 * Request shape ported from pi-web-search (MIT, ttttmr) `src/providers/anthropic.ts`.
 *
 * Pi's own requests get the Claude Code billing block from `extensions/anthropic-subscription`,
 * which wraps the model transport. This call is a direct fetch and skips that wrapper, and an
 * extension may not import another, so the same recipe is repeated here. Anthropic also answered
 * 200 to a request without the block, so it is not what makes the call work; it is there so this
 * request carries the same identity as Pi's own. Whether Anthropic bills by it cannot be seen here.
 */

import { createHash } from "node:crypto";

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

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-5-5";
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
// Keep in step with DEFAULT_VERSION in anthropic-subscription/refs.ts; the same override applies.
const DEFAULT_VERSION = "2.1.280";

function claudeCodeVersion(): string {
    const configured = process.env["PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION"]?.trim() ?? "";

    return /^\d+\.\d+\.\d+$/.test(configured) ? configured : DEFAULT_VERSION;
}

export function billingBlock(prompt: string, version: string): { type: "text"; text: string } {
    const sampled = [4, 7, 20].map((index) => prompt[index] ?? "0").join("");
    const suffix = createHash("sha256")
        .update(`59cf53e54c78${sampled}${version}`)
        .digest("hex")
        .slice(0, 3);
    const cch = createHash("sha256").update(prompt).digest("hex").slice(0, 5);

    return {
        type: "text",
        text: `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=sdk-cli; cch=${cch};`,
    };
}

export function readMessages(body: string): Found {
    let answer = "";
    let stopReason: string | undefined;
    const cited: Source[] = [];
    const searched: Source[] = [];

    for (const event of parseSse(body)) {
        const { type, error, content_block: block, delta } = record(event);

        if (type === "error") {
            throw new Error(
                `stream error: ${str(record(error)["message"]) ?? "unknown"}`.slice(0, 200),
            );
        }

        if (type === "message_delta") {
            stopReason = str(record(delta)["stop_reason"]) ?? stopReason;
        }

        if (type === "content_block_start") {
            const { type: kind, text, content } = record(block);

            // Text before a search is narration ("I'll search for…"); the answer follows the last one.
            if (kind === "server_tool_use" || kind === "web_search_tool_result") {
                answer = "";
            }

            // Blocks are cut at citations, in the middle of a sentence, so they join without a gap.
            if (kind === "text") {
                answer += str(text) ?? "";
            }

            if (kind === "web_search_tool_result") {
                for (const result of list(content)) {
                    const { url, title } = record(result);
                    const link = str(url);

                    if (link !== undefined) {
                        searched.push(sourceOf(link, title));
                    }
                }
            }
        }

        if (type === "content_block_delta") {
            const { type: kind, text, citation } = record(delta);

            if (kind === "text_delta") {
                answer += str(text) ?? "";
            }

            const { url, title } = record(citation);
            const link = str(url);

            if (kind === "citations_delta" && link !== undefined) {
                cited.push(sourceOf(link, title));
            }
        }
    }

    // The answer is cut short or unfinished: better to hand over to the next provider.
    if (stopReason === "pause_turn" || stopReason === "max_tokens") {
        throw new Error(`the answer stopped early (${stopReason})`);
    }

    if (answer.trim() === "") {
        throw new Error("the response had no answer");
    }

    return {
        answer: answer.trim(),
        sources: uniqueSources(cited.length > 0 ? cited : searched),
        model: MODEL,
    };
}

export async function searchAnthropic(
    resolveAuth: ResolveModelAuth,
    prompt: string,
    signal: AbortSignal,
    fetchImpl: typeof fetch = fetch,
): Promise<Found> {
    const token = (await resolveAuth("anthropic", signal))?.apiKey;

    if (token === undefined || !token.startsWith("sk-ant-oat")) {
        throw new Error("not signed in with a Claude subscription");
    }

    const version = claudeCodeVersion();
    const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "text/event-stream",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
            "user-agent": `claude-cli/${version}`,
            "x-app": "cli",
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 4096,
            system: [billingBlock(prompt, version), { type: "text", text: IDENTITY }],
            messages: [{ role: "user", content: prompt }],
            // Without `allowed_callers` the model may run the search from code execution, and the
            // search then fails with `invalid_tool_input`.
            tools: [
                {
                    type: "web_search_20260209",
                    name: "web_search",
                    max_uses: 5,
                    allowed_callers: ["direct"],
                },
            ],
            stream: true,
        }),
        signal,
    });

    if (!response.ok) {
        throw await httpError(response);
    }

    return readMessages(await response.text());
}
