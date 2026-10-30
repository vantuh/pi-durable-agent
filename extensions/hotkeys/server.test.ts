import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_KEYMAP, mergeKeymap, parseBinding, step, type KeyEvent } from "./lib.ts";
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
        command: "session.new",
        consume: true,
    });
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyS")).command, "folder.pick");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyP")).command, "session.prev");
    assert.equal(step(DEFAULT_KEYMAP, true, key("KeyN")).command, "session.next");
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
    assert.equal(Object.keys(merged.keys).length, 4);
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
