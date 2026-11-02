import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageRoute, Route } from "../web/src/lib/deep-link.ts";
import { endsPage, stepsBack } from "../web/src/lib/route.ts";

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
    // The entries the app pushes going chat → root → a commit → its review, each naming the step behind it.
    const entries: Record<string, Route> = { chat, root, commit, review };
    const commitEntry = { route: commit, id: "commit", from: "root" };
    const reviewEntry = { route: review, id: "review", from: "commit" };

    void it("steps back for two parent arrows in a row", () => {
        assert.equal(stepsBack(reviewEntry, entries["commit"], commit), true);
        assert.equal(stepsBack(commitEntry, entries["root"], root), true);
    });

    void it("stops stepping back once the entry behind was replaced", () => {
        // A deep link opens the commit with nothing behind it, then the review is pushed onto it.
        const linked = { route: commit, id: "linked" };
        const onLinked = { route: review, id: "review", from: linked.id };
        const shown: Record<string, Route> = { [linked.id]: commit };

        // The arrow at the review steps back while the entry behind it still shows the commit.
        assert.equal(stepsBack(onLinked, shown[linked.id], commit), true);

        // Browser Back, then the arrow at the commit replaces that entry with the page root.
        shown[linked.id] = root;

        // Forward returns to the review, whose marker still names the commit's entry: it is stale now.
        assert.equal(stepsBack(onLinked, shown[linked.id], commit), false);
    });

    void it("replaces instead without a marker behind it", () => {
        assert.equal(stepsBack(undefined, root, root), false);
        assert.equal(stepsBack({ route: review, id: "review" }, root, commit), false);
        assert.equal(stepsBack(reviewEntry, undefined, commit), false);
    });
});
