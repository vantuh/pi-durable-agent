// Test: the folder picker's arrows step between the rows of one list, and Enter reads the row's folder.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHTML } from "linkedom";

import { folderAt, nextRow, rowsOf } from "../web/src/shell/folder-picker-keys.ts";

/** One pane as the picker draws it: a row is a button carrying its folder, and a favourite row holds a star. */
function pane(): { rows: HTMLElement[]; star: Element } {
    const { document } = parseHTML(`<body><nav id="list">
        <div>
            <button id="star" aria-label="Favourite" type="button"></button>
            <button id="one" data-folder="/one" type="button"><span id="in-one">one</span></button>
        </div>
        <button id="two" data-folder="/two" type="button">two</button>
        <button id="three" data-folder="/three" type="button">three</button>
    </nav></body>`);
    const star = document.getElementById("star");

    assert.ok(star !== null);

    return { rows: rowsOf(document.getElementById("list")), star };
}

const folders = (row: HTMLElement | undefined): string | undefined =>
    row?.getAttribute("data-folder") ?? undefined;

void describe("rowsOf", () => {
    void it("lists the folder rows and leaves a row's star out", () => {
        assert.deepEqual(pane().rows.map(folders), ["/one", "/two", "/three"]);
    });

    void it("has nothing to list for a pane that is not there", () => {
        assert.deepEqual(rowsOf(null), []);
    });
});

void describe("nextRow", () => {
    void it("steps one row down and one back up", () => {
        const { rows } = pane();

        assert.equal(folders(nextRow(rows, rows[0] ?? null, 1)), "/two");
        assert.equal(folders(nextRow(rows, rows[2] ?? null, -1)), "/two");
    });

    void it("wraps at both ends, so neither arrow is a dead end", () => {
        const { rows } = pane();

        assert.equal(folders(nextRow(rows, rows[2] ?? null, 1)), "/one");
        assert.equal(folders(nextRow(rows, rows[0] ?? null, -1)), "/three");
    });

    void it("starts at the top going down and at the bottom going up, from a star or nowhere", () => {
        const { rows, star } = pane();

        assert.equal(folders(nextRow(rows, null, 1)), "/one");
        assert.equal(folders(nextRow(rows, null, -1)), "/three");
        assert.equal(folders(nextRow(rows, star, 1)), "/one");
    });

    void it("has nowhere to go in an empty list", () => {
        assert.equal(nextRow([], null, 1), undefined);
    });
});

void describe("folderAt", () => {
    void it("names the folder of the row the key was pressed in, text or row itself", () => {
        const { document } = parseHTML(
            `<body><button data-folder="/one"><span id="text">one</span></button></body>`,
        );

        assert.equal(folderAt(document.getElementById("text")), "/one");
        assert.equal(folderAt(document.querySelector("[data-folder]")), "/one");
    });

    void it("names no folder for a row's star, or for nothing", () => {
        const { star } = pane();

        assert.equal(folderAt(star), undefined);
        assert.equal(folderAt(null), undefined);
    });
});
