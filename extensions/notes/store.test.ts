// Test: the list the panel and the badge share, and which answer it keeps.
// Run: pnpm test

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Todo } from "./refs.ts";
import { changeTodos, countChange, countOf, refreshTodos, setTodos, todosOf } from "./store.ts";

const todo = (id: number, done = false): Todo => ({
    id,
    title: `t${String(id)}`,
    description: "",
    done,
});

let served: Todo[] | null = [];

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for fetch: it serves the list the test chose
globalThis.fetch = (() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: served }),
    })) as unknown as typeof fetch;

void test("the badge counts the open to-dos of the list the panel shows", async () => {
    assert.equal(countOf(1), 0);
    assert.equal(todosOf(1), undefined);

    served = [todo(1), todo(2, true), todo(3)];
    await refreshTodos(1);
    assert.equal(countOf(1), 2);

    changeTodos(1, (todos) =>
        todos.map((item) => (item.id === 1 ? { ...item, done: true } : item)),
    );
    assert.equal(countOf(1), 1, "a change shows before the server confirms it");
    assert.equal(countOf(2), 0, "another session has its own list");
});

void test("a read does not undo a change that is still on its way", async () => {
    setTodos(5, [todo(1), todo(2)]);
    countChange(5, 1);
    changeTodos(5, (todos) => todos.filter((item) => item.id !== 1));

    served = [todo(1), todo(2)];
    await refreshTodos(5);
    assert.deepEqual(
        todosOf(5)?.map((item) => item.id),
        [2],
        "the older list is dropped",
    );

    countChange(5, -1);
    await refreshTodos(5);
    assert.deepEqual(
        todosOf(5)?.map((item) => item.id),
        [1, 2],
    );
});

void test("a session without a folder keeps no list", async () => {
    served = null;
    await refreshTodos(9);
    assert.equal(todosOf(9), undefined);
});
