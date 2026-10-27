import assert from "node:assert/strict";
import { it } from "node:test";

import { createDictation, type Field } from "./dictate.ts";

type Result = { 0: { transcript: string }; isFinal: boolean };
type Event = { results: Result[] };

class FakeRecognition {
    static made: FakeRecognition[] = [];
    onresult: ((event: Event) => void) | null = null;
    onerror = null;
    onend = null;
    started = false;

    constructor() {
        FakeRecognition.made.push(this);
    }

    start() {
        this.started = true;
    }

    stop() {
        this.started = false;
    }

    abort() {
        this.started = false;
    }
}

Reflect.set(globalThis, "SpeechRecognition", FakeRecognition);

/** A textarea as dictation sees it: setting its text puts the caret at the end, as a browser does. */
class Box implements Field {
    #value: string;
    selectionStart: number;
    selectionEnd: number;

    constructor(value: string, caret = value.length) {
        this.#value = value;
        this.selectionStart = this.selectionEnd = caret;
    }

    get value() {
        return this.#value;
    }

    set value(value: string) {
        this.#value = value;
        this.selectionStart = this.selectionEnd = value.length;
    }

    setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    /** The person types `text` at the caret. */
    type(text: string) {
        const at = this.selectionStart;

        this.value = this.#value.slice(0, at) + text + this.#value.slice(this.selectionEnd);
        this.setSelectionRange(at + text.length, at + text.length);
    }
}

/** Results as the browser sends them: each phrase heard, and whether it is settled. */
const said = (...phrases: [string, boolean][]): Event => ({
    results: phrases.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })),
});

/** Dictation started in `box`, which has the focus unless said otherwise. */
function dictate(box: Box, focused = true) {
    const texts: string[] = [];
    const listening: boolean[] = [];
    const dictation = createDictation({
        field: () => box,
        focused: () => focused,
        onText: (value) => texts.push(value),
        onListening: (value) => listening.push(value),
        onNotice: () => {},
    });

    dictation.toggle();

    const recognition = FakeRecognition.made.at(-1);

    assert.ok(recognition);

    return {
        dictation,
        recognition,
        texts,
        listening,
        hear: (event: Event) => recognition.onresult?.(event),
    };
}

void it("words heard show as they come, and a revision replaces them", () => {
    const box = new Box("");
    const { hear, texts } = dictate(box);

    hear(said(["helo wor", false]));
    assert.equal(box.value, "Helo wor");
    hear(said(["hello world", true]));
    assert.equal(box.value, "Hello world");
    hear(said(["hello world", true], ["again", false]));
    assert.equal(box.value, "Hello world again");
    assert.equal(texts.at(-1), "Hello world again", "the composer hears each change");
});

void it("a phrase still being heard finishes in place around what was typed after it", () => {
    const box = new Box("");
    const { hear } = dictate(box);

    hear(said(["please fix the lo", false]));
    box.type("!");
    hear(said(["please fix the login bug", true]));
    assert.equal(box.value, "Please fix the login bug!");
    assert.equal(box.selectionStart, 25, "the caret stays after what was typed");

    hear(said(["please fix the login bug", true], ["and add a test", false]));
    assert.equal(box.value, "Please fix the login bug! And add a test");
});

void it("words go in at the caret, with a space only where words would touch", () => {
    const box = new Box("Fix the now", 7);
    const { hear } = dictate(box);

    hear(said(["bug", true]));
    assert.equal(box.value, "Fix the bug now");
});

void it("a box without the focus gets the words after its text", () => {
    const box = new Box("Hello", 0);
    const { hear } = dictate(box, false);

    hear(said(["world", true]));
    assert.equal(box.value, "Hello world");
});

void it("stopping with drop ignores what the browser still delivers", () => {
    const box = new Box("");
    const { dictation, recognition, listening } = dictate(box);

    dictation.stop(true);
    assert.equal(recognition.onresult, null);
    assert.equal(recognition.started, false);
    assert.deepEqual(listening, [true, false]);
});

void it("toggling a second time stops without losing the words heard", () => {
    const box = new Box("");
    const { dictation, hear, recognition } = dictate(box);

    hear(said(["almost done", false]));
    dictation.toggle();
    assert.equal(recognition.started, false);
    assert.equal(box.value, "Almost done");
});
