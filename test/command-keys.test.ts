import assert from "node:assert/strict";
import { it } from "node:test";

import {
    commandKeys,
    setCommandKeys,
    subscribeCommandKeys,
    type KeyChord,
    type ShellCommand,
} from "../web/src/sdk/commands.ts";

/** Every wake of a subscriber, so a statement that changes nothing can be shown to wake none. */
function watching(): { wakes: () => number; stop: () => void } {
    let wakes = 0;
    const stop = subscribeCommandKeys(() => {
        wakes += 1;
    });

    return { wakes: () => wakes, stop };
}

const ctrlAThenC: readonly KeyChord[] = [["ctrl", "a"], ["c"]];
const ctrlB: readonly KeyChord[] = [["ctrl", "b"]];

void it("a command's keys are read back, drawn again, and cleared", () => {
    const { wakes, stop } = watching();
    const command: ShellCommand = "session.new";

    assert.equal(commandKeys(command), null);
    setCommandKeys(command, ctrlAThenC);
    assert.deepEqual(commandKeys(command), ctrlAThenC);
    assert.equal(wakes(), 1);

    setCommandKeys(command, ctrlB);
    assert.deepEqual(commandKeys(command), ctrlB);
    assert.equal(wakes(), 2);

    setCommandKeys(command, null);
    assert.equal(commandKeys(command), null);
    assert.equal(wakes(), 3);
    stop();
});

void it("stating the same keys again, or clearing what is not stated, wakes no one", () => {
    const { wakes, stop } = watching();
    const command: ShellCommand = "session.next";

    setCommandKeys(command, [["shift", "right"]]);
    setCommandKeys(command, [["shift", "right"]]);
    assert.equal(wakes(), 1);

    setCommandKeys(command, null);
    setCommandKeys(command, null);
    assert.equal(wakes(), 2);
    stop();
});

void it("one command has one owner: the last extension to state keys keeps them", () => {
    const command: ShellCommand = "session.rename";

    setCommandKeys(command, ctrlB);
    setCommandKeys(command, ctrlAThenC);
    assert.deepEqual(commandKeys(command), ctrlAThenC);

    // The owner that unloads clears what the command shows, whoever stated it last.
    setCommandKeys(command, null);
    assert.equal(commandKeys(command), null);
});

void it("a read hands back the same value until the keys change, so the hook cannot loop", () => {
    const command: ShellCommand = "folder.pick";

    setCommandKeys(command, ctrlAThenC);

    const stated = commandKeys(command);

    // Identity, not content: `useSyncExternalStore` compares what its snapshot returns.
    assert.equal(commandKeys(command), stated);

    // Equal content in new arrays: the store keeps what it holds, so the snapshot does not move.
    setCommandKeys(command, [["ctrl", "a"], ["c"]]);
    assert.equal(commandKeys(command), stated);

    setCommandKeys(command, null);
    assert.equal(commandKeys(command), null);
});

void it("a listener that stopped is not woken again", () => {
    const command: ShellCommand = "session.search";
    const { wakes, stop } = watching();

    setCommandKeys(command, ctrlB);
    assert.equal(wakes(), 1);

    stop();
    setCommandKeys(command, null);
    assert.equal(wakes(), 1);
    assert.equal(commandKeys(command), null);
});

void it("a stated sequence is the registry's own, so a caller's later edit changes nothing", () => {
    const command: ShellCommand = "session.prev";
    const keys: string[][] = [["ctrl", "a"]];

    setCommandKeys(command, keys);
    keys[0]?.push("x");
    keys.push(["z"]);

    assert.deepEqual(commandKeys(command), [["ctrl", "a"]]);
    setCommandKeys(command, null);
});
