import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHTML } from "linkedom";

import {
    composerMayTakeFocus,
    type ComposerScene,
    focusComposer,
    isTypingElsewhere,
    subscribeComposerFocus,
} from "../web/src/sdk/composer.ts";

const calm: ComposerScene = {
    reason: "window",
    lost: true,
    typing: false,
    overlay: false,
    touch: false,
    selecting: false,
};

void describe("composerMayTakeFocus", () => {
    void it("returns to a window or a closed menu when nothing holds the keyboard", () => {
        assert.equal(composerMayTakeFocus(calm), true);
        assert.equal(composerMayTakeFocus({ ...calm, reason: "close" }), true);
    });

    void it("leaves a keyboard that something holds to a returning window, not to a close", () => {
        assert.equal(composerMayTakeFocus({ ...calm, lost: false }), false);
        assert.equal(composerMayTakeFocus({ ...calm, reason: "close", lost: false }), true);
    });

    void it("never takes the caret from a field, an open menu, a selection or a phone", () => {
        for (const reason of ["close", "window"] as const) {
            for (const block of ["typing", "overlay", "selecting", "touch"] as const) {
                assert.equal(
                    composerMayTakeFocus({ ...calm, reason, [block]: true }),
                    false,
                    `${reason} with ${block}`,
                );
            }
        }
    });
});

void describe("isTypingElsewhere", () => {
    const { document } = parseHTML(`<body>
        <input id="search">
        <div id="note" contenteditable="true"><b id="inside">x</b></div>
        <div id="off" contenteditable="false"></div>
        <button id="button"></button>
        <textarea id="message" data-slot="composer-field"></textarea>
        <div role="dialog"><input id="in-dialog"></div>
    </body>`);
    const at = (id: string): Element | null => document.getElementById(id);

    void it("is true for another input or contenteditable text", () => {
        assert.equal(isTypingElsewhere(at("search")), true);
        assert.equal(isTypingElsewhere(at("inside")), true);
    });

    void it("is false for buttons, the composer, a field in a closing dialog, and nothing", () => {
        assert.equal(isTypingElsewhere(at("button")), false);
        assert.equal(isTypingElsewhere(at("off")), false);
        assert.equal(isTypingElsewhere(at("message")), false);
        assert.equal(isTypingElsewhere(at("in-dialog")), false);
        assert.equal(isTypingElsewhere(null), false);
    });
});

void describe("focusComposer", () => {
    void it("says whether a composer took the caret, so a caller can fall back", () => {
        assert.equal(focusComposer(), false);

        let asked = 0;
        const inert = subscribeComposerFocus(() => {
            asked += 1;

            return false;
        });
        assert.equal(focusComposer(), false);

        const live = subscribeComposerFocus(() => true);
        assert.equal(focusComposer(), true);
        assert.equal(asked, 2);

        live();
        inert();
        assert.equal(focusComposer(), false);
    });
});
