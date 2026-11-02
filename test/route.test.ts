import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageRoute, Route } from "../web/src/lib/deep-link.ts";
import { endsPage, keptState, stepsBack } from "../web/src/lib/route.ts";

const routeOf = (session: number | null, page: PageRoute | null = null): Route => ({
    session,
    page,
});

const HISTORY: PageRoute = { key: "git-history:history", sub: undefined };

void describe("endsPage", () => {
    void it("keeps the same instance while the page moves inside itself", () => {
        assert.equal(
            endsPage(
                routeOf(1, { ...HISTORY, sub: "abc123" }),
                routeOf(1, { ...HISTORY, sub: "abc123/review" }),
            ),
            false,
        );
        assert.equal(endsPage(routeOf(1, HISTORY), routeOf(1, HISTORY)), false);
    });

    void it("ends it when the page is closed and opened again", () => {
        assert.equal(endsPage(routeOf(1, HISTORY), routeOf(1)), true);
        assert.equal(endsPage(routeOf(1), routeOf(1, HISTORY)), true);
    });

    void it("ends it for another page, and for another session under the same page", () => {
        assert.equal(
            endsPage(routeOf(1, HISTORY), routeOf(1, { ...HISTORY, key: "codemode:sessions" })),
            true,
        );
        assert.equal(endsPage(routeOf(1, HISTORY), routeOf(2, HISTORY)), true);
    });
});

const chat = routeOf(1);
const root = routeOf(1, HISTORY);
const commit = routeOf(1, { ...HISTORY, sub: "abc123" });
const review = routeOf(1, { ...HISTORY, sub: "abc123/review" });

void describe("stepsBack", () => {
    // The entries the app pushes going chat → root → a commit → its review.
    const commitEntry = { route: commit, from: root };
    const reviewEntry = { route: review, from: commit };

    void it("steps back for two parent arrows in a row", () => {
        assert.equal(stepsBack(reviewEntry, commit), true);
        // The commit's own entry, once Back landed on it and the traversal kept its marker.
        assert.equal(stepsBack(keptState(commitEntry, commit).pi, root), true);
    });

    void it("still steps back to the parent after Forward returned to the child", () => {
        assert.equal(stepsBack(keptState(reviewEntry, review).pi, commit), true);
    });

    void it("replaces instead when the step behind is not the parent", () => {
        // A deep link, and an entry this app rewrote: neither knows a neighbour.
        assert.equal(stepsBack(undefined, root), false);
        assert.equal(stepsBack({ route: review }, commit), false);
        assert.equal(stepsBack(reviewEntry, root), false);
    });
});

void describe("keptState", () => {
    void it("keeps the marker an entry was pushed with", () => {
        const entry = { route: review, from: commit };

        assert.deepEqual(keptState(entry, review), { pi: { route: review, from: commit } });
    });

    void it("writes no marker where there was none", () => {
        assert.deepEqual(keptState(undefined, chat), { pi: { route: chat } });
        assert.deepEqual(keptState({ route: chat }, chat), { pi: { route: chat } });
    });
});
