import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageRoute, Route } from "../web/src/lib/deep-link.ts";
import { endsPage } from "../web/src/lib/route.ts";

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
