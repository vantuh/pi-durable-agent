import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeFromSearch, routeHref, sessionFromSearch } from "../web/src/lib/deep-link.ts";

void describe("sessionFromSearch", () => {
    void it("reads a positive integer", () => {
        assert.equal(sessionFromSearch("?session=42"), 42);
        assert.equal(sessionFromSearch("?x=1&session=7"), 7);
    });

    void it("ignores anything else", () => {
        for (const search of [
            "",
            "?session=",
            "?session=0",
            "?session=-3",
            "?session=1.5",
            "?session=1e3",
            "?session=abc",
            "?session=07",
            "?session=99999999999999999999",
        ]) {
            assert.equal(sessionFromSearch(search), undefined, search);
        }
    });
});

void describe("routeFromSearch", () => {
    void it("reads a page and a place inside it inside a session", () => {
        assert.deepEqual(routeFromSearch("?session=4&page=git-history:history&sub=abc/review"), {
            session: 4,
            page: { key: "git-history:history", sub: "abc/review" },
        });
    });

    void it("leaves the page out without a session, or with an empty key or sub", () => {
        assert.deepEqual(routeFromSearch("?page=git-history:history"), {
            session: null,
            page: null,
        });
        assert.deepEqual(routeFromSearch("?session=4&page="), { session: 4, page: null });
        assert.deepEqual(routeFromSearch("?session=4&page=git-history:history&sub="), {
            session: 4,
            page: { key: "git-history:history", sub: undefined },
        });
    });
});

void describe("routeHref", () => {
    void it("is the session alone when no page is open", () => {
        assert.equal(routeHref({ session: null, page: null }), "/");
        assert.equal(routeHref({ session: 7, page: null }), "/?session=7");
    });

    void it("round-trips a page and its place inside it", () => {
        const route = { session: 7, page: { key: "git-history:history", sub: "abc/review" } };

        assert.deepEqual(routeFromSearch(routeHref(route).slice(1)), route);
    });
});
