# Server

The core server, as it is now: several conversations, one event stream, one way in.

```text
POST /api/messages  ──▶ conversation.submit()  ──▶ durable generation task
                                              │ commits
                                              ▼
GET /api/events     ◀── broadcast()  ◀── viewState.subscribe()
GET /api/history        { entries, more } of the durable log, older than `before`
GET /api/health         { ok, model, cwd, home, session }
GET /api/extensions     { installed, failed, extensions: [{ name, title, description, enabled, installed, error? }] }
PUT /api/extensions/:name   { enabled: boolean } → the new list entry (400 bad body, 404 unknown folder)
POST /api/abort         stops the current run
```

- `server/main.ts` — the HTTP surface, the harness, the subscription.
- `server/history.ts` — the older transcript, paged back from the entry log.
- `server/extensions.ts` — the loader ([extensions.md](extensions.md)).
- `server/projection.ts` — the harness's committed view → `shared/protocol.ts`.
- `shared/protocol.ts` — the only contract the browser sees.

## Why the view, not the callbacks

`root.viewState()` is committed state. Every event on the wire is derived from it, never from a
stream handler. A browser that connects mid-run gets a `hello` with the whole transcript and the
live state, so nothing has to be replayed and nothing can arrive out of order.

## The view is not the whole conversation

The view is the **active** transcript: it starts at the newest head marker. A compaction — automatic
when a request would not fit the model's window, and a model with a smaller window can bring that on
by itself — writes a `pi.compaction` entry with a head, and from then on the view no longer carries
anything before it. The entries are still in storage; they are simply not in the view.

So the start of a long conversation is reached through `GET /api/history`, not through the stream:

```text
GET /api/history?session=7&before=7463   → { entries: [...], more: false }
```

`hello` carries the same fact in one bit: `more`, true when the log keeps entries older than the
oldest one it just sent. It comes from one read of the oldest entry (`hasOlder()`), so a screen that
already holds the whole conversation never asks for a page it cannot get, and knows it can show
counts rather than a spinner.

`before` is the oldest entry the browser already has; the answer is older than it, oldest entry
first. `server/history.ts` reads the entry log (`conversation.entries()`, descending with its
cursor) and ends a page at a question, so a page never starts in the middle of a turn: a `toolResult`
without the assistant that called it would be dropped by the transcript's grouping. `more` says
whether older entries are left. Nothing here is cached: the log is append-only, so a page asked for
twice is the same page.

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
the only assertion on stored data, and it is written down as such: a document that an older version
of this file wrote must not crash the process. The other assertion is in `server/main.ts`: a session id from the browser (a plain number) becomes
a `ConversationId`, with a disable comment that says why. Anything else that needs an `as` is a design smell.

## Running it

```bash
pnpm serve     # node --watch server/main.ts, port 8788
pnpm dev       # vite on 5190, proxying /api → 8788
```

For production, run `pnpm start`: build the web into `dist/`, then run the server on
`127.0.0.1:8788` without watch. One process serves both the web and API. Stop it with Ctrl+C.
The command does not configure Tailscale or install an auto-start service.

To expose it privately through Tailscale Serve, configure a free HTTPS port once:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8788
```

Check `tailscale serve status` first: do not replace another app's proxy. Serve stays configured
between app restarts; `pnpm start` starts only the app. Use Serve, not public Funnel. Anyone allowed
to reach this endpoint through Tailscale can control the agent; restrict access with Tailscale rules.
The proxy must preserve the public `Host` for extension origin checks.

- `MODEL` — `provider/modelId`, default `openai/gpt-6.1-sol`. Signs in through `~/.pi/agent`
  (`ModelRuntime.create()`), the same logins the `pi` command uses.
- `PORT` — default 8788. Not 8787: Pi Pocket runs there on this machine.
- `data/state.sqlite` — the only state, gitignored. Delete it for a clean conversation.

## Beyond the first conversation

```text
GET  /api/sessions           the list: title, folder, model, thinking level, busy, activeAt
POST /api/sessions           { cwd } → a new conversation with the default model
POST /api/sessions/archive   { session, archived }  sidebar visibility only
POST /api/sessions/delete    { session }  gone from every list; see [session-delete.md](session-delete.md)
POST /api/messages           { session, text, files, mode? }  mode: steer | followUp | interrupt
POST /api/queued/withdraw    { session, id } → { result }  result: aborted | already_placed | settled | not_found
                             deletes the `pi.inbox` item; 400 bad id (an unknown session is a 500, as everywhere)
POST /api/agent              { session, model?, thinkingLevel? }
GET  /api/models             { scoped, all, default }
POST /api/default            { model: { provider, modelId }, thinkingLevel }  → "Make default"
POST /api/extensions/:extension/actions/:action   { session?, args? } → { result }
                             400 bad body or ActionError · 404 unknown extension, action or session · 500
```

The default model is the `app.settings` session document. It survives a restart; `MODEL` is used
until one is chosen. `live.queued` is `pi.inbox`'s messages; `live.status` is what extensions add.

## The web shell

A path outside `/api/` is a file of `dist/` (`pnpm build`), served by `server/static.ts` on the same
origin as the API. `GET` and `HEAD` only (others get 405); `/` is `index.html`.

- `/assets/*` has hashed names: `immutable`, one year. Everything else is `no-cache`, so the HTML
  and `sw.js` are never stale.
- A path that leaves `dist/` or has bad escapes is refused (404, 400).
- No fallback to `index.html`: the app routes by query string, so a missing file is a 404.
- Without a build, every such path is a 404; the API is not affected.

## Not here yet

Auth.
