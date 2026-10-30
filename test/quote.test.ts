import assert from "node:assert/strict";
import { it } from "node:test";

import { quoteBlock, splitQuote, withQuotes } from "../web/src/lib/quote.ts";
import {
    addComposerQuote,
    clearComposerQuotes,
    composerQuotes,
    removeComposerQuote,
    subscribeComposerQuotes,
} from "../web/src/sdk/composer.ts";

void it("sends a quote as a blockquote and reads it back with the words the person wrote after it", () => {
    const text = "First line\n\nlast line";
    const sent = withQuotes([text], "  What about this?  ");

    assert.equal(sent, "> First line\n>\n> last line\n\nWhat about this?");
    assert.deepEqual(splitQuote(sent), { quotes: [text], rest: "What about this?" });
    assert.deepEqual(splitQuote(withQuotes([text], "")), { quotes: [text], rest: "" });
    assert.equal(withQuotes([], "  plain text  "), "plain text");
    assert.equal(splitQuote("plain text"), undefined);
    assert.equal(splitQuote(">"), undefined);
});

void it("keeps several quotes apart, so each one comes back as the words it was", () => {
    const sent = withQuotes(["one", "two\nlines"], "mine");

    assert.equal(quoteBlock("one"), "> one");
    assert.equal(sent, "> one\n\n> two\n> lines\n\nmine");
    assert.deepEqual(splitQuote(sent), { quotes: ["one", "two\nlines"], rest: "mine" });
    assert.deepEqual(splitQuote(withQuotes(["one", "two"], "")), {
        quotes: ["one", "two"],
        rest: "",
    });
});

void it("holds quotes per session until they are removed or sent", () => {
    let notifications = 0;
    const unsubscribe = subscribeComposerQuotes(() => {
        notifications += 1;
    });

    addComposerQuote("700", " a quote ");
    addComposerQuote("700", "a quote");
    addComposerQuote("700", "another");
    assert.deepEqual(composerQuotes("700"), ["a quote", "another"]);
    assert.deepEqual(composerQuotes("701"), []);

    removeComposerQuote("700", 0);
    assert.deepEqual(composerQuotes("700"), ["another"]);

    clearComposerQuotes("700");
    assert.deepEqual(composerQuotes("700"), []);
    assert.equal(notifications, 4);
    unsubscribe();
    clearComposerQuotes("700");
    assert.equal(notifications, 4);
});
