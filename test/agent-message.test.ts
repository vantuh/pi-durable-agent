import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ClientAuthor } from "../shared/protocol.ts";
import { startVite } from "./fixtures/vite.ts";

/** The card is TSX, which `node --test` cannot strip: it is loaded the way the app loads it. */
async function renderCard(author: ClientAuthor): Promise<string> {
    const { vite: server, stop } = await startVite("custom", {
        // Nothing to prebundle: the card is imported for a render, not served.
        optimizeDeps: { noDiscovery: true },
    });

    try {
        const { AgentMessage } = await server.ssrLoadModule("/src/transcript/agent-message.tsx");
        const { TooltipProvider } = await server.ssrLoadModule("/src/components/ui/tooltip.tsx");

        // The app's root provides it; the card's open link is a tooltip trigger.
        return renderToStaticMarkup(
            createElement(
                TooltipProvider,
                null,
                createElement(AgentMessage, { text: "found it", author, onOpenSession: () => {} }),
            ),
        );
    } finally {
        await stop();
    }
}

void describe("a message from an agent", () => {
    void it("names the model the author reported without its provider, and the whole of it on hover", async () => {
        const html = await renderCard({
            name: "Scout",
            session: 4,
            model: "anthropic/claude-sonnet-4-6",
        });

        assert.match(html, /title="anthropic\/claude-sonnet-4-6"/, html);
        assert.match(html, /<span[^>]*truncate[^>]*>claude-sonnet-4-6<\/span>/, html);
        assert.ok(!html.includes(">anthropic/claude-sonnet-4-6<"), html);
        const badge = html.indexOf('data-slot="badge"');

        assert.ok(badge > html.indexOf("</button>"), "the badge follows the collapse trigger");
        assert.ok(badge < html.indexOf("<a "), "the badge precedes the open-conversation link");
    });

    void it("draws no model badge for an author that reported none", async () => {
        const html = await renderCard({ name: "Scout", session: 4 });

        assert.ok(!html.includes('data-slot="badge"'), html);
        assert.match(html, /Scout/, html);
    });
});
