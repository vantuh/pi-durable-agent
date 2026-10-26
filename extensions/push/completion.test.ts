import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Completions, type CommitSlice } from "./completion.ts";

let next = 0;

const user = () => ({ id: (next += 1), kind: "pi.user", model: [{ role: "user" }] });
const answer = (stopReason: string) => ({
    id: (next += 1),
    kind: "pi.assistant",
    model: [{ role: "assistant", stopReason }],
});

function commit(entries: CommitSlice["entries"], busy: boolean, session = 1): CommitSlice {
    return { session: { id: session }, entries, busy };
}

const count = (done: Completions, view: CommitSlice, remembered?: number) =>
    done.observe(view, remembered).done;

void describe("push completions", () => {
    void it("does not notify for history seen on the first commit", () => {
        const done = new Completions();
        const history = [user(), answer("stop")];

        assert.equal(count(done, commit(history, false)), 0);
        assert.equal(count(done, commit(history, false)), 0);
    });

    void it("notifies once when a run ends with a final answer", () => {
        const done = new Completions();

        done.observe(commit([], false));

        const asked = [user()];
        const working = [...asked, answer("toolUse")];
        const finished = [...working, answer("stop")];

        assert.equal(count(done, commit(asked, true)), 0);
        assert.equal(count(done, commit(working, true)), 0);
        assert.equal(count(done, commit(finished, true)), 0);
        assert.equal(count(done, commit(finished, false)), 1);
        assert.equal(count(done, commit(finished, false)), 0);
    });

    void it("notifies when the final answer commits with the run already idle", () => {
        const done = new Completions();

        done.observe(commit([], false));

        assert.equal(count(done, commit([user(), answer("stop")], false)), 1);
    });

    void it("does not notify for an error, an abort or a tool-only round", () => {
        for (const reason of ["error", "aborted", "toolUse", "length"]) {
            const done = new Completions();

            done.observe(commit([], false));

            assert.equal(count(done, commit([user(), answer(reason)], false)), 0, reason);
        }
    });

    void it("does not notify when a later error follows an answer in the same run", () => {
        const done = new Completions();

        done.observe(commit([], false));

        assert.equal(count(done, commit([user(), answer("stop"), answer("error")], false)), 0);
    });

    void it("counts a queued turn when the next message starts while busy", () => {
        const done = new Completions();

        done.observe(commit([], false));

        const one = [user(), answer("stop")];
        const second = user();
        const two = [...one, second, answer("stop")];

        assert.equal(count(done, commit(one, true)), 0);
        assert.equal(count(done, commit([...one, second], true)), 1);
        assert.equal(count(done, commit(two, true)), 0);
        assert.equal(count(done, commit(two, false)), 1);
    });

    void it("keeps conversations apart", () => {
        const done = new Completions();

        done.observe(commit([], false, 1));
        done.observe(commit([], false, 2));

        assert.equal(count(done, commit([user(), answer("stop")], false, 2)), 1);
        assert.equal(count(done, commit([], false, 1)), 0);
    });

    void it("sets a new baseline after a reload (a new instance)", () => {
        const history = [user(), answer("stop")];

        assert.equal(count(new Completions(), commit(history, false)), 0);
    });

    void it("finds a turn that ended while the extension reloaded, from the remembered point", () => {
        const before = [user(), answer("stop")];
        const first = new Completions();

        first.observe(commit([], false));

        const asked = [...before, user()];
        const { settled } = first.observe(commit(asked, true));
        const finished = [...asked, answer("stop")];
        // The old version is gone; the new one gets the idle snapshot with the final answer.
        const reloaded = new Completions();

        assert.equal(count(reloaded, commit(finished, false), settled), 1);
        assert.equal(count(reloaded, commit(finished, false)), 0);
    });

    void it("finds an answer that is still waiting for idle after a reload", () => {
        const asked = [user()];
        const answered = [...asked, answer("stop")];
        const first = new Completions();

        first.observe(commit([], false));

        const { settled } = first.observe(commit(answered, true));

        assert.equal(count(new Completions(), commit(answered, true), settled), 0);
        assert.equal(count(new Completions(), commit(answered, false), settled), 1);
    });

    void it("does not repeat a turn when the same snapshot arrives again", () => {
        const done = new Completions();

        done.observe(commit([], false));

        const view = commit([user(), answer("stop")], false);

        assert.equal(count(done, view), 1);
        assert.equal(count(done, view), 0);
        assert.equal(count(new Completions(), view, done.observe(view).settled), 0);
    });

    void it("prefers the saved point over what the instance remembers", () => {
        const done = new Completions();

        done.observe(commit([], false));

        const view = commit([user(), answer("stop")], false);

        // Another version already saved the point past this turn.
        assert.equal(count(done, view, Math.max(...view.entries.map((entry) => entry.id))), 0);
    });

    void it("does not notify old history when nothing is remembered", () => {
        assert.equal(
            count(new Completions(), commit([user(), answer("stop")], false), undefined),
            0,
        );
    });
});
