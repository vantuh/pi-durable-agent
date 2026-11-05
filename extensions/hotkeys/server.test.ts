import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseHTML } from "linkedom";

import {
    caps,
    COMMANDS,
    DEFAULT_KEYMAP,
    fieldKeeps,
    inDialog,
    mergeKeymap,
    ownsKeys,
    parseBinding,
    presses,
    step,
    type KeyEvent,
} from "./lib.ts";
import { readKeymap } from "./server.ts";

function key(code: string, modifiers: Partial<KeyEvent> = {}): KeyEvent {
    return {
        code,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        ...modifiers,
    };
}

const ctrlA = key("KeyA", { ctrlKey: true });

void test("parseBinding maps keys to layout-independent codes", () => {
    assert.deepEqual(parseBinding("ctrl+a"), {
        prefixed: false,
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
        code: "KeyA",
    });
    assert.equal(parseBinding("prefix+c")?.prefixed, true);
    assert.equal(parseBinding("prefix+c")?.code, "KeyC");
    assert.equal(parseBinding("shift+left")?.code, "ArrowLeft");
    assert.equal(parseBinding("shift+left")?.shift, true);
    assert.equal(parseBinding("prefix+5")?.code, "Digit5");
    assert.equal(parseBinding("prefix+[")?.code, "BracketLeft");
    assert.equal(parseBinding("meta+/")?.code, "Slash");
});

void test("parseBinding rejects what it does not know", () => {
    assert.equal(parseBinding(""), null);
    assert.equal(parseBinding("ctrl+"), null);
    assert.equal(parseBinding("hyper+a"), null);
    assert.equal(parseBinding("ctrl+nonsense"), null);
    assert.equal(parseBinding("constructor"), null);
    assert.equal(parseBinding("ctrl+f1"), null);
});

void test("a prefix needs ctrl, alt or meta, and a key without the prefix must not type a character", () => {
    assert.ok(parseBinding("ctrl+a", "prefix"));
    assert.ok(parseBinding("alt+space", "prefix"));
    assert.equal(parseBinding("a", "prefix"), null);
    assert.equal(parseBinding("shift+a", "prefix"), null);
    assert.equal(parseBinding("prefix+a", "prefix"), null);

    assert.ok(parseBinding("shift+left"));
    assert.ok(parseBinding("escape"));
    assert.ok(parseBinding("ctrl+k"));
    assert.ok(parseBinding("prefix+k"));
    assert.equal(parseBinding("k"), null);
    assert.equal(parseBinding("shift+k"), null);
    assert.equal(parseBinding("5"), null);
    assert.equal(parseBinding("space"), null);
    assert.equal(parseBinding("shift+/"), null);
});

void test("prefix then a bound key runs its command, then goes idle", () => {
    assert.deepEqual(step(DEFAULT_KEYMAP, false, ctrlA), {
        armed: true,
        command: null,
        consume: true,
    });
    assert.deepEqual(step(DEFAULT_KEYMAP, true, key("KeyC")), {
        armed: false,
        command: "session.new.pick",
        consume: true,
    });
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyS")).command, "folder.pick");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyP")).command, "session.prev");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyF")).command, "session.search");
    assert.equal(step(DEFAULT_KEYMAP, true, key("Comma")).command, "session.rename");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyN")).command, "session.next");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyB")).command, "sidebar.toggle");
});

void test("Escape or an unbound key after the prefix cancels without a command", () => {
    assert.deepEqual(step(DEFAULT_KEYMAP, true, key("Escape")), {
        armed: false,
        command: null,
        consume: true,
    });
    assert.deepEqual(step(DEFAULT_KEYMAP, true, key("KeyZ")), {
        armed: false,
        command: null,
        consume: true,
    });
});

void test("the prefix twice disarms and passes the second key on", () => {
    assert.deepEqual(step(DEFAULT_KEYMAP, true, ctrlA), {
        armed: false,
        command: null,
        consume: false,
    });
});

void test("while armed, a modifier alone keeps the prefix waiting, and a held key is swallowed", () => {
    assert.deepEqual(step(DEFAULT_KEYMAP, true, key("ShiftLeft", { shiftKey: true })), {
        armed: true,
        command: null,
        consume: false,
    });
    assert.deepEqual(step(DEFAULT_KEYMAP, true, key("KeyC", { repeat: true })), {
        armed: true,
        command: null,
        consume: true,
    });
});

void test("a key bound without the prefix runs at once, and only with exactly its modifiers", () => {
    assert.deepEqual(step(DEFAULT_KEYMAP, false, key("ArrowRight", { shiftKey: true })), {
        armed: false,
        command: "session.next",
        consume: true,
    });
    assert.equal(
        step(DEFAULT_KEYMAP, false, key("ArrowLeft", { shiftKey: true })).command,
        "session.prev",
    );
    assert.deepEqual(step(DEFAULT_KEYMAP, false, key("ArrowRight")), {
        armed: false,
        command: null,
        consume: false,
    });
    assert.equal(
        step(DEFAULT_KEYMAP, false, key("ArrowRight", { shiftKey: true, ctrlKey: true })).command,
        null,
    );
    assert.equal(step(DEFAULT_KEYMAP, false, key("KeyC")).command, null);
});

void test("ownsKeys leaves the keys typed into a field to that field", () => {
    assert.equal(ownsKeys({ tagName: "INPUT", isContentEditable: false }), true);
    assert.equal(ownsKeys({ tagName: "TEXTAREA", isContentEditable: false }), true);
    assert.equal(ownsKeys({ tagName: "SELECT", isContentEditable: false }), true);
    assert.equal(ownsKeys({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(ownsKeys({ tagName: "DIV", isContentEditable: false }), false);
    assert.equal(ownsKeys({ tagName: "BUTTON", isContentEditable: false }), false);
});

void test("a field keeps its keys, except the prefix that arms the shell", () => {
    const typed = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
    const left = key("ArrowLeft", { shiftKey: true });

    // The prefix reaches `step` from a field, where it arms instead of being swallowed.
    assert.equal(fieldKeeps(typed, DEFAULT_KEYMAP, ctrlA), false);
    assert.deepEqual(step(DEFAULT_KEYMAP, false, ctrlA), {
        armed: true,
        command: null,
        consume: true,
    });

    // Shift+Left in an ordinary field selects text: the shell must not switch sessions under it.
    assert.equal(fieldKeeps(typed, DEFAULT_KEYMAP, left), true);
    assert.equal(step(DEFAULT_KEYMAP, false, left).command, "session.prev");

    // Only a field keeps anything: elsewhere the same key is the shell's.
    assert.equal(
        fieldKeeps(
            { tagName: "DIV", isContentEditable: false, closest: () => null },
            DEFAULT_KEYMAP,
            left,
        ),
        false,
    );
});

void test("a field that opted into the shell's keys lets the session arrows through", () => {
    const left = key("ArrowLeft", { shiftKey: true });
    const right = key("ArrowRight", { shiftKey: true });
    // The composer's textarea: `data-shell-keys` on it, as the shell writes it.
    const composer = {
        tagName: "TEXTAREA",
        isContentEditable: false,
        closest: (selector: string) => (selector === "[data-shell-keys]" ? {} : null),
    };

    assert.equal(fieldKeeps(composer, DEFAULT_KEYMAP, left), false);
    assert.equal(step(DEFAULT_KEYMAP, false, left).command, "session.prev");
    assert.equal(fieldKeeps(composer, DEFAULT_KEYMAP, right), false);
    assert.equal(step(DEFAULT_KEYMAP, false, right).command, "session.next");

    // The prefix arms there too, as it does in any other field.
    assert.equal(fieldKeeps(composer, DEFAULT_KEYMAP, ctrlA), false);
    assert.equal(step(DEFAULT_KEYMAP, false, ctrlA).armed, true);
});

void test("a terminal keeps the prefix its own shell needs", () => {
    // The terminal's textarea: `data-own-keys` on the container, as the panel writes it.
    const terminal = {
        tagName: "TEXTAREA",
        isContentEditable: false,
        closest: (selector: string) => (selector === "[data-own-keys]" ? {} : null),
    };

    assert.equal(fieldKeeps(terminal, DEFAULT_KEYMAP, ctrlA), true);
    assert.equal(fieldKeeps(terminal, DEFAULT_KEYMAP, key("ArrowLeft", { shiftKey: true })), true);
});

void test("a dialog owns the keyboard, an alert dialog too", () => {
    const { document } = parseHTML(`
        <div role="dialog"><button id="in-dialog"></button></div>
        <div role="alertdialog"><button id="in-alert"></button></div>
        <button id="outside"></button>
    `);
    const at = (id: string) => document.querySelector(`#${id}`);

    assert.equal(inDialog(at("in-dialog")), true);
    // A confirmation is an alert dialog: the shell's keys must not fire behind one either.
    assert.equal(inDialog(at("in-alert")), true);
    assert.equal(inDialog(at("outside")), false);
    assert.equal(inDialog(null), false);
});

void test("a held prefix does not arm", () => {
    const result = step(DEFAULT_KEYMAP, false, key("KeyA", { ctrlKey: true, repeat: true }));

    assert.equal(result.armed, false);
    assert.equal(result.consume, true);
});

void test("mergeKeymap lays valid entries over the defaults and drops the rest", () => {
    const merged = mergeKeymap({
        prefix: "ctrl+b",
        keys: {
            "session.new": "prefix+n",
            "folder.pick": ["prefix+f", "nonsense+x", 7],
            "session.prev": ["junk+junk"],
            "session.next": [],
            "unknown.command": "prefix+q",
        },
    });

    assert.equal(merged.prefix, "ctrl+b");
    assert.deepEqual(merged.keys["session.new"], ["prefix+n"]);
    assert.deepEqual(merged.keys["folder.pick"], ["prefix+f"]);
    assert.deepEqual(merged.keys["session.prev"], DEFAULT_KEYMAP.keys["session.prev"]);
    assert.deepEqual(merged.keys["session.next"], []);
    assert.deepEqual(Object.keys(merged.keys).toSorted(), [...COMMANDS].toSorted());
});

void test("an extension's command keeps its default when the file predates it", () => {
    // A file written before git-history bound a key: the entry is missing, not empty.
    const merged = mergeKeymap({ keys: { "session.search": "prefix+k" } });

    assert.deepEqual(merged.keys["extension.git-history.open"], ["prefix+g"]);
    assert.equal(step(merged, true, key("KeyG")).command, "extension.git-history.open");
    assert.deepEqual(mergeKeymap(undefined).keys["extension.git-history.open"], ["prefix+g"]);
});

void test("mergeKeymap refuses a prefix without a modifier and a bare printable key", () => {
    assert.equal(mergeKeymap({ prefix: "prefix+a" }).prefix, DEFAULT_KEYMAP.prefix);
    assert.equal(mergeKeymap({ prefix: "a" }).prefix, DEFAULT_KEYMAP.prefix);
    assert.equal(mergeKeymap({ prefix: "zzz" }).prefix, DEFAULT_KEYMAP.prefix);
    assert.deepEqual(
        mergeKeymap({ keys: { "session.new": ["k", "shift+j", "prefix+k"] } }).keys["session.new"],
        ["prefix+k"],
    );
    assert.deepEqual(mergeKeymap([1, 2]), DEFAULT_KEYMAP);
});

void test("readKeymap reads hotkeys.json from the given directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hotkeys-"));

    assert.deepEqual(await readKeymap(dir), DEFAULT_KEYMAP);

    await writeFile(
        join(dir, "hotkeys.json"),
        JSON.stringify({ keys: { "session.new": "prefix+x" } }),
    );
    assert.deepEqual((await readKeymap(dir)).keys["session.new"], ["prefix+x"]);

    await writeFile(join(dir, "hotkeys.json"), "{ not json");
    assert.deepEqual(await readKeymap(dir), DEFAULT_KEYMAP);
});

void test("a binding is drawn as the presses it is, prefix first", () => {
    assert.deepEqual(presses(DEFAULT_KEYMAP, "prefix+c"), [["ctrl", "a"], ["c"]]);
    assert.deepEqual(presses(DEFAULT_KEYMAP, "shift+left"), [["shift", "left"]]);
    assert.deepEqual(presses(DEFAULT_KEYMAP, "prefix+,"), [["ctrl", "a"], [","]]);
    assert.deepEqual(presses({ ...DEFAULT_KEYMAP, prefix: "meta+a" }, "prefix+n"), [
        ["meta", "a"],
        ["n"],
    ]);
});

void test("a binding parseBinding accepts is drawn with its tokens normalised", () => {
    assert.notEqual(parseBinding("PREFIX + F"), null);
    assert.deepEqual(presses(DEFAULT_KEYMAP, "PREFIX + F"), [["ctrl", "a"], ["f"]]);
    assert.notEqual(parseBinding("SHIFT + Left"), null);
    assert.deepEqual(presses(DEFAULT_KEYMAP, "SHIFT + Left"), [["shift", "left"]]);
    assert.deepEqual(presses(DEFAULT_KEYMAP, " Prefix + , "), [["ctrl", "a"], [","]]);
    assert.deepEqual(presses({ ...DEFAULT_KEYMAP, prefix: "Meta + A" }, "prefix+n"), [
        ["meta", "a"],
        ["n"],
    ]);
    assert.deepEqual(caps("SHIFT + SHIFT + Left"), ["shift", "left"]);
});

void test("a key written twice is drawn once, and every command of the default keymap is drawable", () => {
    assert.deepEqual(caps("shift+shift+left"), ["shift", "left"]);
    assert.deepEqual(caps("prefix+a"), ["prefix", "a"]);

    for (const command of COMMANDS) {
        for (const binding of DEFAULT_KEYMAP.keys[command]) {
            const drawn = presses(DEFAULT_KEYMAP, binding).flat();

            assert.ok(drawn.length >= 2, `${binding} of ${command} drew ${drawn.join("+")}`);
            assert.ok(!drawn.includes("prefix"), `${binding} of ${command} kept its prefix word`);
        }
    }
});
