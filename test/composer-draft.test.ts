import assert from "node:assert/strict";
import { it } from "node:test";

import {
    appendComposerDraft,
    composerDraft,
    setComposerDraft,
    subscribeComposerDraft,
} from "../web/src/sdk/composer.ts";

void it("appends extension feedback without replacing text, leaking sessions, duplicating or sending", () => {
    let notifications = 0;
    const unsubscribe = subscribeComposerDraft(() => {
        notifications += 1;
    });
    setComposerDraft("123456", "My existing instructions");
    appendComposerDraft(123456, "Review feedback", "unique-result");
    appendComposerDraft(123456, "Review feedback", "unique-result");
    assert.equal(composerDraft("123456"), "My existing instructions\n\nReview feedback");
    assert.equal(composerDraft("123457"), "");
    assert.equal(notifications, 2);
    unsubscribe();
    setComposerDraft("123456", "");
    assert.equal(composerDraft("123456"), "");
    assert.equal(notifications, 2);
});
