# Server

The core server, as it is now: one conversation, one event stream, one way in.

```text
POST /api/messages  ──▶ root.submit()  ──▶ durable generation task
                                              │ commits
                                              ▼
GET /api/events     ◀── broadcast()  ◀── viewState.subscribe()
GET /api/health         { ok, model, busy, cwd, branch, title, usage }
GET /api/extensions     { installed, failed }
POST /api/abort         stops the current run
```

- `server/main.ts` — the HTTP surface, the harness, the subscription.
- `server/extensions.ts` — the loader ([extensions.md](extensions.md)).
- `server/projection.ts` — the harness's committed view → `shared/protocol.ts`.
- `shared/protocol.ts` — the only contract the browser sees.

## Why the view, not the callbacks

`root.viewState()` is committed state. Every event on the wire is derived from it, never from a
stream handler. A browser that connects mid-run gets a `hello` with the whole transcript and the
live state, so nothing has to be replayed and nothing can arrive out of order.

## Entries: tail or replace

`entries` are immutable, so a commit usually only appends. The server remembers the ids every
connected browser already has:

- the new ids **extend** what was sent → send only the tail, `replace: false`;
- anything else changed (a reset or a compaction rewrote the active transcript) → send all of it,
  `replace: true`.

The live answer is not an entry. It arrives as `live` on every commit, with at most 100 ms between
commits, and becomes an `assistant` entry when it is final.

## One guarded door

Every value taken from a document is `unknown` until narrowed. `recordOf()` in `projection.ts` is
the only assertion in the server, and it is written down as such: a document that an older version
of this file wrote must not crash the process. Anything else that needs an `as` is a design smell.

## Running it

```bash
pnpm serve     # node --watch server/main.ts, port 8788
pnpm dev       # vite on 5190, proxying /api → 8788
```

- `MODEL` — `provider/modelId`, default `openai/gpt-6.1-sol`. Signs in through `~/.pi/agent`
  (`ModelRuntime.create()`), the same logins the `pi` command uses.
- `PORT` — default 8788. Not 8787: Pi Pocket runs there on this machine.
- `data/state.sqlite` — the only state, gitignored. Delete it for a clean conversation.

## Not here yet

Several conversations, titles, a model picker, auth, and static file serving.
