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
POST /api/restart       { ok } then exit 75, for `scripts/serve.ts` to start the server again; 409 without it
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
already holds the whole conversation never asks for a page it cannot get.

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

Every value taken from a document is `unknown` until narrowed. `recordOf()` in `projection.ts` is
the only assertion on stored data, and it is written down as such: a document that an older version
of this file wrote must not crash the process. The other assertion is in `server/main.ts`: a session id from the browser (a plain number) becomes
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
GET  /api/sessions/events    SSE: { type: "sessions", sessions } at once, then after every change a row shows
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

The default model is the `app.settings` session document. It survives a restart; `MODEL` is used
until one is chosen. `live.queued` is `pi.inbox`'s messages; `live.status` is what extensions add. `live.revision` moves when an extension called `host.notifySessionChanged` for the session (at most once per 250 ms) and is absent before that.

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
