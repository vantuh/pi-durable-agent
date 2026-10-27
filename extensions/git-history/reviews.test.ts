import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { git } from "./git.ts";
import { plannotatorCookies, reviewProxy, scopedCookies } from "./proxy.ts";
import { Reviews } from "./reviews.ts";

const FAKE = `#!/usr/bin/env node
import http from 'node:http';
let patch='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)patch+=chunk;
if(process.env.FAIL_REVIEW){console.error('fake startup failure');process.exit(2);}
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html><head></head><body>review</body></html>');return;}
 if(req.url==='/api/diff'){res.setHeader('content-type','application/json');res.end(JSON.stringify({patch,args:process.argv.slice(2)}));return;}
 if(req.url==='/api/stream'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: ready\\n\\n');return;}
 if(req.url==='/api/feedback'){let text='';for(const event of ['data'])req.on(event,c=>text+=c);req.on('end',()=>{res.end('ok');console.log(JSON.stringify({decision:'annotated',message:'feedback:'+text}));server.close();});return;}
 if(req.url==='/api/echo'){let text='';req.on('data',c=>text+=c);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({body:text,origin:req.headers.origin,cookie:req.headers.cookie??null,authorization:req.headers.authorization??null}));});return;}
 res.writeHead(404);res.end();
});
server.listen(0,'127.0.0.1',()=>setTimeout(()=>console.error('Plannotator session ready: http://localhost:'+server.address().port),process.env.SLOW_REVIEW?1000:0));
`;
async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for review");
        }
        await delay(20);
    }
}
void describe("embedded review lifecycle and proxy", () => {
    let dir: string;
    let repo: string;
    let command: string;
    let reviews: Reviews;
    let base: string;
    let close: () => Promise<void>;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "review-process-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git(repo, ["init", "-b", "main"]);
        await writeFile(join(repo, "file"), "new\n");
        command = join(dir, "plannotator.mjs");
        await writeFile(command, FAKE, { mode: 0o755 });
        reviews = new Reviews("/api/extensions/git-history/http", { command });
        const handler = reviewProxy(reviews);
        const server = createServer((request, response) => {
            void handler({ request, response, path: request.url ?? "/" });
        });
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.ok(address !== null && typeof address !== "string");
        base = `http://127.0.0.1:${String(address.port)}`;
        close = () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
    });
    afterEach(async () => {
        await close();
        await reviews.dispose();
        await rm(dir, { recursive: true, force: true });
    });
    void it("starts without a browser, proxies HTML/API/streams and captures feedback", async () => {
        const initial = reviews.start(1, repo, "worktree");
        assert.equal(initial.state, "starting");
        assert.equal(reviews.start(1, repo, "worktree").id, initial.id);
        assert.throws(() => reviews.start(1, repo, "abcdef"), /Finish or cancel/);
        await until(() => reviews.state(1)?.state !== "starting");
        assert.equal(reviews.state(1)?.state, "running", JSON.stringify(reviews.state(1)));
        const url = base + "/" + initial.id;
        const html = await (await fetch(url + "/")).text();
        assert.match(html, /window.fetch=/);
        assert.match(html, /review<\/body>/);
        const header = (await fetch(url + "/")).headers.get("content-security-policy");
        assert.match(header ?? "", /frame-ancestors 'self'/);
        const diff: unknown = await (await fetch(url + "/api/diff")).json();
        assert.ok(typeof diff === "object" && diff !== null && "args" in diff);
        assert.deepEqual(diff.args, [
            "review",
            "--json",
            "--no-git-remote-check",
            "--git",
            "--diff-type",
            "uncommitted",
        ]);
        const echo: unknown = await (
            await fetch(url + "/api/echo", {
                method: "POST",
                body: "upload",
                headers: { origin: base, cookie: "app-secret", authorization: "Bearer app-secret" },
            })
        ).json();
        assert.deepEqual(echo, {
            body: "upload",
            origin: `http://127.0.0.1:${String(reviews.jobs.get(1)?.port)}`,
            cookie: null,
            authorization: null,
        });
        const stop = new AbortController();
        const stream = await fetch(url + "/api/stream", { signal: stop.signal });
        const reader = stream.body?.getReader();
        assert.ok(reader);
        assert.match(new TextDecoder().decode((await reader.read()).value), /data: ready/);
        stop.abort();
        await fetch(url + "/api/feedback", { method: "POST", body: "notes" });
        await until(() => reviews.state(1)?.state === "done");
        assert.equal(reviews.state(1)?.message, "feedback:notes");
        assert.equal((await fetch(url + "/api/diff")).status, 410);
    });
    void it("cancels, rejects stale/wrong-session cancellation and cleans up processes", async () => {
        const view = reviews.start(1, repo, "worktree");
        await until(() => reviews.state(1)?.state === "running");
        await assert.rejects(reviews.cancel(2, view.id), /no longer current/);
        await assert.rejects(reviews.cancel(1, "wrong"), /no longer current/);
        await reviews.cancel(1, view.id);
        assert.equal(reviews.state(1)?.state, "cancelled");
        const next = reviews.start(1, repo, "worktree");
        assert.notEqual(next.id, view.id);
        await until(() => reviews.state(1)?.state === "running");
        await reviews.dispose();
        assert.equal(reviews.state(1), null);
    });
    void it("stops the child even while Plannotator is still starting", async () => {
        await reviews.dispose();
        reviews = new Reviews("/http", { command, env: { ...process.env, SLOW_REVIEW: "1" } });
        const view = reviews.start(1, repo, "worktree");
        await until(() => reviews.jobs.get(1)?.child?.pid !== undefined);
        const child = reviews.jobs.get(1)?.child;
        assert.ok(child);
        assert.equal(reviews.state(1)?.state, "starting");
        await reviews.cancel(1, view.id);
        assert.equal(reviews.state(1)?.state, "cancelled");
        assert.ok(child.exitCode !== null || child.signalCode !== null);
        assert.equal(reviews.find(view.id), undefined);
    });
    void it("reports missing CLI and startup errors", async () => {
        await reviews.dispose();
        reviews = new Reviews("/http", { command: join(dir, "missing") });
        reviews.start(1, repo, "worktree");
        await until(() => reviews.state(1)?.state === "failed");
        assert.match(reviews.state(1)?.error ?? "", /not installed/);
        await reviews.dispose();
        reviews = new Reviews("/http", { command, env: { ...process.env, FAIL_REVIEW: "1" } });
        reviews.start(1, repo, "worktree");
        await until(() => reviews.state(1)?.state === "failed");
        assert.match(reviews.state(1)?.error ?? "", /fake startup failure/);
    });
    void it("uses static stdin patches for a selected commit and never checks it out", async () => {
        await git(repo, ["add", "."]);
        await git(repo, [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "root",
        ]);
        const sha = (await git(repo, ["rev-parse", "HEAD"])).trim();
        const view = reviews.start(1, repo, sha);
        await until(() => reviews.state(1)?.state !== "starting");
        assert.equal(reviews.state(1)?.state, "running", JSON.stringify(reviews.state(1)));
        const data: unknown = await (await fetch(base + "/" + view.id + "/api/diff")).json();
        assert.ok(
            typeof data === "object" &&
                data !== null &&
                "patch" in data &&
                typeof data.patch === "string" &&
                "args" in data,
        );
        assert.match(data.patch, /\+new/);
        assert.deepEqual(data.args, [
            "review",
            "--json",
            "--no-git-remote-check",
            "--patch-file",
            "-",
        ]);
        assert.equal((await git(repo, ["symbolic-ref", "--short", "HEAD"])).trim(), "main");
    });
    void it("refuses unknown proxy capabilities and arbitrary upstream URLs", async () => {
        for (const path of [
            "/http://example.com/",
            "/123/api/diff",
            "/" + "a".repeat(48) + "/api/diff",
        ]) {
            assert.equal((await fetch(base + path)).status, 410);
        }
        assert.throws(() => reviews.start(1, repo, "--help"), /Choose a commit/);
    });
});

void it("forwards only Plannotator preference cookies and scopes response cookies", () => {
    assert.equal(
        plannotatorCookies(
            "auth=secret; plannotator-theme=dark; session=secret; plannotator-identity=me",
        ),
        "plannotator-theme=dark; plannotator-identity=me",
    );
    assert.deepEqual(
        scopedCookies(
            [
                "session=secret; Path=/",
                "plannotator-seen=true; Domain=localhost; Path=/; SameSite=Lax",
            ],
            "/api/extensions/git-history/http",
        ),
        ["plannotator-seen=true; SameSite=Lax; Path=/api/extensions/git-history/http"],
    );
});
