// Test: the history page's keyboard — the list's cursor, the detail's scroll, Escape out of each — and what holds it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHTML } from "linkedom";

import { heldBy, landingRow, nextRow, pageStep, type PageKeyboard } from "./keys.ts";

const calm: PageKeyboard = {
    where: "list",
    key: "ArrowDown",
    modified: false,
    held: false,
    composing: false,
    taken: false,
};

void describe("pageStep", () => {
    void it("moves the list's cursor with the arrows, and opens no commit by itself", () => {
        assert.deepEqual(pageStep(calm), { kind: "move", by: 1 });
        assert.deepEqual(pageStep({ ...calm, key: "ArrowUp" }), { kind: "move", by: -1 });

        // Enter, Tab and a letter are the row button's own: one open per press.
        for (const key of ["Enter", "Tab", "g", " "]) {
            assert.deepEqual(pageStep({ ...calm, key }), { kind: "none" }, key);
        }
    });

    void it("scrolls the commit's diff with the arrows, and leaves a review's own frame alone", () => {
        assert.deepEqual(pageStep({ ...calm, where: "commit" }), { kind: "scroll", by: 1 });
        assert.deepEqual(pageStep({ ...calm, where: "commit", key: "ArrowUp" }), {
            kind: "scroll",
            by: -1,
        });
        assert.deepEqual(pageStep({ ...calm, where: "review" }), { kind: "none" });
    });

    void it("closes a list with Escape, and steps back from a commit or its review", () => {
        assert.deepEqual(pageStep({ ...calm, key: "Escape" }), { kind: "close" });
        assert.deepEqual(pageStep({ ...calm, where: "commit", key: "Escape" }), { kind: "back" });
        assert.deepEqual(pageStep({ ...calm, where: "review", key: "Escape" }), { kind: "back" });
    });

    void it("leaves every key to a field, a dialog, a terminal, a modifier and a composition", () => {
        for (const held of [
            { held: true },
            { composing: true },
            { taken: true },
            { modified: true },
        ]) {
            for (const key of ["ArrowDown", "ArrowUp", "Escape"]) {
                assert.deepEqual(pageStep({ ...calm, ...held, key }), { kind: "none" }, key);
            }
        }

        // The guards hold for a commit's diff too, where a modified arrow is the scroller's own step.
        assert.deepEqual(pageStep({ ...calm, where: "commit", modified: true }), { kind: "none" });
    });
});

void describe("heldBy", () => {
    const { document } = parseHTML(`<body>
        <input id="search">
        <textarea id="message"></textarea>
        <div id="note" contenteditable="true"><b id="in-note">x</b></div>
        <div id="off" contenteditable="false"></div>
        <div role="dialog"><button id="in-dialog"></button></div>
        <div role="alertdialog"><button id="in-alert"></button></div>
        <form><button id="save">Save</button></form>
        <div data-own-keys><textarea id="terminal"></textarea></div>
        <ol><li><button id="row"><span id="subject">a commit</span></button></li></ol>
    </body>`);
    const at = (id: string): Element | null => document.getElementById(id);

    // A form holds them too: the reword form's Save and Cancel must not lose the draft to an Escape.
    void it("holds the keys for a field, a contenteditable, a dialog, a form and a terminal", () => {
        for (const id of [
            "search",
            "message",
            "note",
            "in-note",
            "in-dialog",
            "in-alert",
            "save",
            "terminal",
        ]) {
            assert.equal(heldBy(at(id)), true, id);
        }
    });

    void it("leaves them to the page for a row, the text inside it, and nothing at all", () => {
        assert.equal(heldBy(at("off")), false);
        assert.equal(heldBy(at("row")), false);
        assert.equal(heldBy(at("subject")), false);
        assert.equal(heldBy(document.body), false);
        assert.equal(heldBy(null), false);
    });
});

void describe("nextRow", () => {
    const { document } = parseHTML(`<ol>
        <li><button id="one">one</button></li>
        <li><button id="two">two</button></li>
        <li><button id="three">three</button></li>
    </ol>`);
    const rows = [...document.querySelectorAll("button")];
    const at = (id: string): Element | undefined =>
        [...document.querySelectorAll("button")].find((row) => row.id === id);

    void it("steps one row down and one back up", () => {
        assert.equal(nextRow(rows, at("one") ?? null, 1), at("two"));
        assert.equal(nextRow(rows, at("three") ?? null, -1), at("two"));
    });

    void it("wraps at both ends, so neither arrow is a dead end", () => {
        assert.equal(nextRow(rows, at("three") ?? null, 1), at("one"));
        assert.equal(nextRow(rows, at("one") ?? null, -1), at("three"));
    });

    void it("starts at the top going down and at the bottom going up, from nowhere", () => {
        assert.equal(nextRow(rows, null, 1), at("one"));
        assert.equal(nextRow(rows, null, -1), at("three"));
        assert.equal(nextRow(rows, document.body, 1), at("one"));
    });

    void it("has nowhere to go in an empty list", () => {
        assert.equal(nextRow([], null, 1), undefined);
        assert.equal(nextRow([], document.body, -1), undefined);
    });
});

void describe("landingRow", () => {
    const drawn = ["sha-3", "sha-2", "sha-1"];

    void it("lands on the row the page rings, which the last visit left behind", () => {
        assert.equal(landingRow(drawn, "sha-2"), "sha-2");
    });

    void it("lands on the first row for none, and for a ringed commit older than the page of history read", () => {
        assert.equal(landingRow(drawn, undefined), "sha-3");
        assert.equal(landingRow(drawn, "sha-70"), "sha-3");
        assert.equal(landingRow([], "sha-3"), undefined);
    });
});
