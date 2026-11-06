import assert from "node:assert/strict";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

import { bridgeScript, embedHtml } from "./bridge.ts";

void it("rebases fetch and SSE without rewriting external URLs or rebasing twice", async () => {
    const calls: string[] = [];
    class Resource {
        setAttribute() {}
    }
    class Stream {
        readonly url: string;
        constructor(url: string) {
            this.url = url;
            calls.push(url);
        }
    }
    const window = {
        fetch(input: string) {
            calls.push(input);
            return Promise.resolve();
        },
        EventSource: Stream,
        WebSocket: Stream,
    };
    class Xhr {
        open() {}
    }
    const context = {
        window,
        URL,
        Request,
        location: {
            href: "https://agent.example/review/id/",
            origin: "https://agent.example",
            host: "agent.example",
        },
        navigator: { sendBeacon() {} },
        XMLHttpRequest: Xhr,
        Element: Resource,
        HTMLImageElement: Resource,
        HTMLScriptElement: Resource,
        HTMLLinkElement: Resource,
        HTMLAnchorElement: Resource,
        HTMLIFrameElement: Resource,
        HTMLSourceElement: Resource,
        HTMLMediaElement: Resource,
    };
    const script = bridgeScript("/review/id")
        .replace(/^<script>/, "")
        .replace(/<\/script>$/, "");
    runInNewContext(script, context);
    await window.fetch("/api/diff");
    await window.fetch("/review/id/api/draft");
    await window.fetch("https://external.example/api/x");
    const stream = new window.EventSource("/api/stream");
    void stream;
    assert.deepEqual(calls, [
        "/review/id/api/diff",
        "/review/id/api/draft",
        "https://external.example/api/x",
        "/review/id/api/stream",
    ]);
    assert.match(
        embedHtml('<html><head><link rel="icon" href="/favicon.png"></head></html>', "/review/id"),
        /href="\/review\/id\/favicon.png"/,
    );
    assert.throws(() => embedHtml("not html", "/review/id"), /unsupported HTML/);
});
