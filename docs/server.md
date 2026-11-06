# Server

The core server, as it is now: several conversations, one event stream, one way in.

```text
POST /api/messages  ──▶ conversation.submit()  ──▶ durable generation task
                                              │ commits
                                              ▼
GET /api/events     ◀── broadcast()  ◀── Conversation.watch()
GET /api/history        { entries, more } of the durable log, older than `before`
GET /api/health         { ok, model, cwd, home, session }
GET /api/extensions     { installed, failed, extensions: [{ name, title, description, enabled, installed, error? }] }
PUT /api/extensions/:name   { enabled: boolean } → the new list entry (400 bad body, 404 unknown folder)
POST /api/abort         stops the current run
POST /api/restart       { ok } then exit 75, for `scripts/serve.ts` to start the server again; 409 without it
POST /api/build         { ok, log } rebuilds `dist/` with the checkout's Vite; no restart needed
```

- `server/main.ts` — the composition root: opens the lock, the port and the harness, builds the streams and the
  extension loader, mounts the routes, and stops them. It keeps no long-lived state of its own beyond what boot
  creates.
- `server/app.ts` — the Hono app: the host, same-origin and HEAD gates, the list refresh after a route, and every
  route (`mountRoutes`, whose type is `AppType`).
- `server/streams/` — the two event streams: `conversation.ts` (attach and detach, the last state of each session,
  the `hello`, live frames), `hello.ts` (the byte-cut first page), `sessions.ts` (the list: whole, then rows),
  `event-stream.ts` (a frame written to many responses, the heartbeat).
- `server/extension-sessions.ts` — what an extension may ask of one session: its next request, its context, its
  first prompt.
- `server/conversation-id.ts` — `idOf`, the one place a plain session number becomes a `ConversationId`.
- `server/history.ts` — the older transcript, paged back from the entry log.
- `server/extensions/` — the extension loader ([extensions.md](extensions.md)): `extensions.ts` owns what is
  installed and registered; `contract.ts` (the types an extension sees), `host.ts` (the host one version is
  handed), `versions.ts` (the live version of each folder and the ones draining), `watcher.ts`,
  `discovery.ts`, `module-exports.ts`, `resolve-hook.ts`, `collision.ts`, `listeners.ts`.
- `server/errors.ts`, `server/image-types.ts`, `server/user-entry.ts` — leaves that a route, a service and the
  projection all read.
- `server/projection.ts` — the harness's committed view → `shared/protocol.ts`.
- `shared/protocol.ts` — the only contract the browser sees.

## Why the view, not the callbacks

`Conversation.watch()` hands over the conversation's committed state: a window of its entries and its
documents. Every event on the wire is derived from it, never from a stream handler. A browser that
connects mid-run gets a `hello` with the newest page of the transcript and the live state, so nothing
has to be replayed and nothing can arrive out of order.

## Bytes over a slow link

Both event streams (`/api/events`, `/api/sessions/events`) and the big JSON answers
(`/api/sessions`, `/api/history`) are gzipped when the client's `accept-encoding` takes it, with
`vary: accept-encoding` saying the bytes differ by client. The list is read again on every connect,
while the server answers in milliseconds: those bytes are what a phone over a slow link waits for.
A compressed stream flushes every frame as it is written, so the first paint costs nothing, and a
body under a kilobyte stays plain.

`hello` is also cut by bytes: the newest entries up to `HELLO_BYTES` (128 KB, about a second at
1 Mbit/s and about 35 KB gzipped). Opening a session shows its last turns; a session whose window
does not start the conversation, or that this cut shortened, says `more`, and the transcript asks
`/api/history` for the rest as it scrolls up. The newest entry is always sent, so one huge entry
cannot open an empty screen. The window counts entries, not bytes (an answer or a tool call can be
hundreds of kilobytes), so the cut stays: 100 entries can be far over 128 KB.

## The view is a window

The view holds the newest **50 entries** and grows with appends to **100**; past that it drops its
oldest in one step, back to 50. Head markers such as `pi.compaction` stay where they were written, and
a compaction hides nothing: the entries it summarized are in the window like any other. A view that opened on
50 entries or fewer holds the whole conversation until it passes 100.

The view says what is before it: `view.before`, the id of the entry just ahead of the window, absent
when the window starts the conversation. So the start of a long conversation is reached through
`GET /api/history`, not through the stream:

```text
GET /api/history?session=7&before=7463   → { entries: [...], more: false }
```

`hello` carries the same fact in one bit: `more`, true when the view has a `before` or the byte cut left
entries out. It is read from the same value the page is cut from, so there is no read and no race,
and a screen that already holds the whole conversation never asks for a page it cannot get.

`before` is the oldest entry the browser already has; the answer is older than it, oldest entry
first. `server/history.ts` reads the entry log (`conversation.entries()`, descending with its
cursor) and ends a page at a question, so a page never starts in the middle of a turn: a `toolResult`
without the assistant that called it would be dropped by the transcript's grouping. `more` says
whether older entries are left. Nothing here is cached: the log is append-only, so a page asked for
twice is the same page.

Extensions get the window too: a commit listener's `entries` is the window, and `host.sessionContext`
reads the entries the next request is built from.

## Entries: appends by id

`entries` are immutable and ids only grow, so a commit only appends, and the browser upserts by id.
The server keeps one number per session, the newest entry id it has sent, and a commit sends the
entries of the window above it. It never compares the window with the last one: the window drops its
oldest entries when it is trimmed, which would look like a rewrite and send 50 entries a browser
already holds. A browser keeps every entry it was sent; the window only limits what the server
computes and what a new `hello` carries.

Known limit: if one watch call folds more than 50 appended entries (the watch merges the commits made
while its listener runs), the entries between what a browser holds and the window are never sent. A
commit that writes a few entries, a subagent's or a run's, cannot do that.

The live answer is not an entry. It arrives as `live`, at most one frame per 250 ms per session
(`LIVE_FRAME_MS`; the first goes at once, the commits inside a window become one at its end, and an
entry commit sends its frame without waiting), and becomes an `assistant` entry when it is final.
A `text` or `thinking` block in a `live` frame carries only the end the client lacks, `from` being
the offset it starts at; the server remembers what each client holds, and a block that is not a
continuation of it goes whole, without `from`. A `toolCall` block carries its `args` only when they
differ from the block the client holds at that position (same `id` and `name`, equal JSON); a call
that was already sent goes without them, and the client keeps what it has. The call still being
written, the last block of the streamed answer, goes out with `args: {}`: Pi 1.5 parses its arguments
as they stream, and every frame would carry them whole again. They arrive once the answer moves past
the call, or with the entry. A running tool's output is not sent.

## Messages from application authors

An extension can submit model input while choosing an application entry for the transcript. Core
uses a generic author convention in `server/projection.ts`, without knowing the extension's name:

- For an application entry outside the explicitly handled core kinds, its first model message
  must have `role: "user"` and its `data.author` must be a non-empty string. It then projects as
  `kind: "user"` with `author: { name, session? }` instead of an invisible `kind: "other"` entry.
- `data.text`, when a string, is the displayed text; otherwise the text comes from the model
  message's content. This lets an application keep routing headers in model input without showing
  them in the card.
- An optional numeric `data.session` supplies `author.session`, the source conversation's ID.
  The browser offers an open-conversation link when it is present. It does not change which
  conversation receives the input.
- An optional non-empty string `data.model` supplies `author.model`, the model that author says
  answered it; the transcript draws it as a badge beside the name. Anything else, including an
  absent field, leaves it out: nothing is inferred for an author that names no model.
- Ordinary `pi.user` and `chat.user` entries also preserve author metadata when provided. An
  unknown application entry without a valid author remains `kind: "other"`.

The same metadata is projected from queued `pi.inbox` inputs into `ClientQueued.author`, so the
queue does not display an application's message as if the person typed it. The transcript draws
an authored message as a folded card with its name and bot icon; the queue shows its author and
mode, permits withdrawal, and does not offer editing it into the person's own draft.

For example, an input with application data `{ text: "Found a defect.", author: "Reviewer",
session: 12 }` appears under **Reviewer**, linking to session 12. The model still receives the
submission's `content`, not a reconstruction from that displayed text. Author metadata is a display
convention, not an authentication or trust boundary, and folding a card does not reduce model context.

## One guarded door

Every value taken from a document is `unknown` until narrowed. `recordOf()` in `shared/guards.ts` is the
one way to take a record out of it, so a document that an older version of this file wrote cannot
crash the process. The other assertion is `idOf` in `server/conversation-id.ts`: a session id from the browser (a plain number) becomes
a `ConversationId`, with a disable comment that says why. Anything else that needs an `as` is a design smell.

## Running it

```bash
pnpm dev       # the whole app: vite on 5190 (HMR on every web change) and the server on 8788
pnpm serve     # the server alone, no web build: dist/ or the API, port 8788
```

`pnpm dev` is the one command for working on it: the browser keeps its live reload, and the
server runs under `scripts/serve.ts`, so the Restart button in Settings starts it again.

For production, run `pnpm start`: build the web into `dist/`, then run the server on
`127.0.0.1:8788`. One process serves both the web and API. Stop it with Ctrl+C.
The command does not configure Tailscale or install an auto-start service.

### Restarting the server from the app

Settings → the restart button asks `POST /api/restart`, which answers `{ ok: true }` and then ends
the process with code 75. `scripts/serve.ts` reads that code and starts the server again; running
work is durable and resumes in the new process, and the browser's event stream reconnects on its
own. Nothing watches files: a change under `server/` or `shared/` goes live through that button.

A server started any other way (`node server/main.ts`) has no parent to start it again, so it
answers **409** instead of stopping.

### Rebuilding the web shell from the app

Settings → the hammer asks `POST /api/build`, which runs the same Vite build as `pnpm build` in this
checkout and answers `{ ok, log }` when it is over (about a second). `log` is Vite's output, cut to
its first 4000 characters, which on a failure is the error and its file:line.

No restart follows: `server/static.ts` reads `dist/` per request, so a reload loads the new shell.
One build runs at a time — a second click waits for the build already writing `dist/`.

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
- `PI_DURABLE_DATA_DIR` — the folder of `state.sqlite` and the other data files, default `data/` in the
  working folder.

One process owns a `state.sqlite` (`server/lifecycle.ts`). It holds an exclusive transaction on a second
SQLite file, `state.sqlite.owner.sqlite`, next to the real `state.sqlite`. The path is resolved first, so
another `PORT`, `TMPDIR` or a symlinked folder meets the same owner. Then it binds the port, and only then
opens storage. Until ready, connections are reset so the browser's event stream keeps retrying;
answering 503 would end it. A second server exits with "in use by another server" before it touches
`state.sqlite` or `uploads/`. The lock is let go after the harness has closed,
and the kernel drops it when the process dies, so no stale state needs cleaning. The owner file is empty,
permanent and not part of the schema; never delete it while a server runs. If storage fails the harness
session, the server logs `pi-durable-agent: storage session failed` and the original error to stderr,
and nothing else.

## Beyond the first conversation

```text
GET  /api/sessions           the list: name (null while the first question names it), title (what the row shows),
                             folder, model, thinking level, busy, activeAt, unseen, parent and endedAt when known
GET  /api/sessions/events    SSE: { type: "sessions", sessions } at once, then after every change
                             { type: "rows", rows, gone }, and { type: "extension-notice", notice }
                             when an extension has something to say about a session
POST /api/sessions           { cwd } → a new conversation with the default model
POST /api/sessions/archive   { session, archived }  sidebar visibility only
POST /api/sessions/delete    { session }  gone from every list; see [session-delete.md](session-delete.md)
POST /api/sessions/seen      { session }  its latest run is seen; see [sessions-live.md](sessions-live.md)
POST /api/messages           { session, text, files, mode? }  mode: steer | followUp | interrupt
POST /api/queued/withdraw    { session, id } → { result }  result: aborted | already_placed | settled | not_found
                             deletes the `pi.inbox` item; 400 bad id (an unknown session is a 500, as everywhere)
POST /api/agent              { session, model?, thinkingLevel? }
GET  /api/models             { scoped, all, default }
POST /api/default            { model: { provider, modelId }, thinkingLevel }  → "Make default"
POST /api/extensions/:extension/actions/:action   { session?, args? } → { result }
                             400 bad body or ActionError · 404 unknown extension, action or session · 500
```

## Routing

`server/app.ts` builds the app: one Hono instance with two middlewares in front of every route — the
`Host` gate that blocks DNS rebinding, the built shell for a path outside `/api/`
(`server/static.ts`), the same-origin gate for `/api/`, and the session-list bookkeeping that runs
after the route. Each `server/routes/<group>.ts` returns a chained sub-app, so a route declares its
path and method instead of a regular expression in a table.

A route checks its input with a Zod schema, declared in the route file: `jsonBody` for the JSON body
and `queryOf` for the query string (`server/validate.ts`), and the handler reads the result from
`c.req.valid("json")` or `c.req.valid("query")`. A refused request answers 400 with `{ error }`, one
sentence per route. `jsonBody` reads the body through `readJson`, so a body past 100 MB answers 413 and
one that is not JSON answers 400, and it records the session the body names for the list refresh.
The browser's client (`hc`, in `web/src/lib/api.ts`) reads its types from the routes through
`AppType` (`server/app-type.ts`), so a route answers with `c.json(body, status)` rather than writing
JSON by hand; a raw write has no type for the browser, and the client parses that answer itself.
Three things do write the response, and return `RESPONSE_ALREADY_SENT` so the adapter leaves it
alone: the two event streams, a file's bytes (`/api/entry-image`, `/api/uploads`, and the two answers
gzipped for size, `/api/sessions` and `/api/history`), and an extension's own HTTP, which still hands
the extension the raw `{ request, response, path }` it always had.
`@hono/node-server`'s `getRequestListener` plugs the app into the `node:http` server that
`server/lifecycle.ts` keeps owning (admission before ready, shutdown, one 500 fallback).

A conversation runs its tools where it was created: the folder of its agent document is the
`cwd` of every tool call, taken at each use, so a session started in a worktree works there and not
where the server runs. A folder that is gone ends every call with `Working directory does not
exist: <folder>`; the conversation stays readable all the same.

The default model is the `app.settings` session document. It survives a restart; `MODEL` is used
until one is chosen. `live.queued` is `pi.inbox`'s messages; `live.status` is what extensions add. `live.revision` moves when an extension called `host.notifySessionChanged` for the session (at most once per 250 ms) and is absent before that.

## The web shell

A path outside `/api/` is a file of `dist/` (`pnpm build`), served by `server/static.ts` on the same
origin as the API. `GET` and `HEAD` only (others get 405); `/` is `index.html`.

- `/assets/*` has hashed names: `immutable`, one year. Everything else is `no-cache`, so the HTML
  and `sw.js` are never stale.
- `.html`, `.js`, `.css` and `.webmanifest` are sent as brotli or gzip when `Accept-Encoding` allows
  it (`vary: accept-encoding`), compressed once per file version and kept in memory.
- A path that leaves `dist/` or has bad escapes is refused (404, 400).
- No fallback to `index.html`: the app routes by query string, so a missing file is a 404.
- Without a build, every such path is a 404; the API is not affected.

## Not here yet

Auth.
