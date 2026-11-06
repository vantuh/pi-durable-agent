# Refactor plan: structure, Hono, pi 1.5

A cleanup, not a rewrite, done on the `refactor/structure` worktree
(`data/worktrees/pi-durable-agent/structure`). The goal is a structure that a person and an agent can
read: smaller files, one exported component per file, one responsibility per file, typed HTTP
routes, and library primitives where we used to write our own.

Status marks: `[x]` done (with commit), `[~]` in progress, `[ ]` to do. Every step keeps behaviour
unless it says otherwise, and lands only with `pnpm check` and `pnpm test` green. A non-trivial
step also gets an independent review before the next one starts.

Working rules:

- **A move commit only moves.** Files move with `git mv` and imports follow; a split or a rename of a
  symbol is its own commit, so a reviewer can read a move as a move.
- **A fix found by review is tested first**: the test fails on the old code, then passes.
- **Tests are not weakened to pass a refactor.** An assertion changes only when the behaviour change
  is intended and written under its phase here.
- **This file is updated in the commit that does the step.**
- **A rule learned on the way goes into [conventions.md](conventions.md)**, not into this plan: the
  plan ends, the rules stay. Findings about pi 1.5 go into [pi-1.5-migration.md](pi-1.5-migration.md).

## Decisions

| Area             | Decision                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components       | One exported component per `.tsx`, named after it. Small unexported helpers used only in that file may stay. shadcn primitives keep their compound API. Rules: [conventions.md](conventions.md#file-and-folder-structure).                                       |
| HTTP framework   | Hono, not Express or Fastify: validators give typed bodies, and `hc` gives the browser types inferred from the routes, so the wire types are written once.                                                                                                       |
| Validation       | Zod, through `@hono/zod-validator`. Schemas the browser also needs live in `shared/`.                                                                                                                                                                            |
| Raw Node paths   | SSE, extension raw HTTP, byte answers and static files write to `c.env.outgoing` and return `RESPONSE_ALREADY_SENT`. `streamSSE` and `hono/compress` would drop the gzip flush per event and the 1 MB stall cap.                                                 |
| Browser types    | `web/` may `import type { AppType }` from `server/` for `hc`, and nothing else from `server/`. The rule in `AGENTS.md` was relaxed in phase 3 (`server/app-type.ts`).                                                                                            |
| Front and server | Stay one repository with vertical extension folders. A monorepo (`apps/web`, `apps/server`) would cut every extension in half.                                                                                                                                   |
| pi 1.5           | Upgrade forward only; no rollback to 1.4. Back up `data/state.sqlite` before the first 1.5 start.                                                                                                                                                                |
| Order            | Hono first (it rebuilds the routes anyway), then pi 1.5 (it rewrites the stream code in `server/main.ts`), then the `server/main.ts` split, so nothing is moved twice.                                                                                           |
| Not taken        | An SSE library (it would replace ~50 lines and none of the gzip, stall or snapshot logic); TanStack Query, a router library, Zustand (the data arrives over SSE, and `route.ts` owns a phone page stack); Feature-Sliced Design (it fights the extension model). |

## Phase 0: ground rules

- [x] Worktree `refactor/structure` from `main` `64c32fe`.
- [x] File and folder structure rules in `docs/conventions.md`, pointers in `AGENTS.md` — `9de2b01`.

## Phase 1: Hono as the route table

- [x] Add `hono` and `@hono/node-server` — `797dfaf`.
- [x] Route factories return chained Hono sub-apps; `server/lifecycle.ts` keeps the socket, admission
      and shutdown through `getRequestListener`; the `Route` table, the dispatcher and the WeakMap body
      re-read are gone — `2c2badc`.
- [x] `AGENTS.md`, `docs/stack.md`, `docs/server.md` describe the new routing — `8c2fafb`.
- [x] Independent review of `9de2b01..8c2fafb`; its five findings fixed — `7b9e2b3` (an extension
      gets the path still encoded; a bad escape in a name answers 400), `a0a77fa` (`changedSession`
      on every JSON route that has a session, no list refresh after a route that threw, route
      factories keep their inferred schema).

Known differences, all accepted: `Content-Type` casing and `Content-Length` on `c.json` answers; a
missing or malformed `Host` gets the adapter's 400 instead of 403; a HEAD guard keeps HEAD answers as
they were.

## Phase 2: Zod validation

- [x] Add `zod` and `@hono/zod-validator`: `build: add zod and @hono/zod-validator`. `b6fa987`
- [x] Pin what every route answers to input it refuses, on the real server, before touching a route:
      `test(server): pin what the routes answer to input they refuse` (`test/route-answers.test.ts`). `6e65a8c`
- [x] One route file at a time: replace `recordOf` and field checks with schemas; error bodies and
      statuses stay as they are. The body is read by `jsonBody` in `server/validate.ts`, not by Hono's
      JSON validator (see [conventions.md](conventions.md#hono-routes)); a query goes through
      `queryOf`, which wraps `zValidator("query")`.
    - [x] `sessions`: `refactor(server): validate the session routes with Zod` `95c3026`
    - [x] `models`: `refactor(server): validate the model routes with Zod` `ee13c1a`
    - [x] `files`: `refactor(server): validate the file routes with Zod` `ee982c6`
    - [x] `conversation`: `refactor(server): validate the conversation routes with Zod` `db313f4`
    - [x] `extensions`: `refactor(server): validate the extension routes with Zod` `1160f6f`
    - The three inline routes of `mountRoutes` (`/api/build`, `/api/restart`, `/api/health`) read no
      input, so they have no schema.
- [x] Record `changedSession` in one place: `jsonBody` sets it from the body's `session`, checked or
      refused; no route sets it (`test/validate.test.ts`).
- [x] Map `HttpError` in `app.onError`, so an oversized `/api/files` body answers 413, not 500:
      `5e16142` `fix(server): answer an HttpError with its own status`. `readBytes` also stops destroying the
      socket past the limit (the client saw a reset, never an answer) and drops the rest of the body.
- [x] Decide whether the HEAD guard stays: it stays. Hono answers HEAD from the GET route, and the
      GET routes of `/api/events` and `/api/sessions/events` open an event stream and register a client
      with no reader; `/api/uploads` and `/api/entry-image` write bytes by hand. The guard keeps HEAD an
      unknown request there, as before; an extension's own HTTP still takes every method.
- [x] Remove helpers the schemas made unused: `string()` and `sessionIdOf()` in `server/http.ts`,
      `parseActionBody()` in `server/extensions.ts`, the `recordOf` calls in the routes. `readJson` stays
      (`jsonBody` and the extension SDK use it); `shared/guards.ts` stays (`projection.ts` and
      `extensions/git-history` use it).
- [x] Review fixes: `jsonBody` marks no session for extension routes (`marksSession: false`), and
      fields with a `.catch` fallback also get `.default`, so `hc` may leave them out
      (`test/route-inputs.types.ts`): `fix(server): keep extension bodies out of the list refresh and
      the fallback fields optional` `cffe552`.
- [x] Independent review of `43fa317..2ae79be`: no blockers, no runtime regressions; its two notes
      are the fixes above.

## Phase 3: typed browser client (`hc`)

- [x] Export `AppType` from the server (`server/app-type.ts`); relax the `web/` import rule in
      `AGENTS.md` to `import type` of `AppType` only; oxlint's `no-restricted-imports` enforces it for
      `web/**`: `refactor(web): export AppType for the typed client`. `c008dcb`. The guard is
      path-based: it exempts `server/app-type.ts` as a file and rejects every other `server/` path. It
      does not check that an import is type-only; that holds because `app-type.ts` exports nothing but a
      type and `consistent-type-imports` demands `import type` for one.
- [x] Move `web/src/lib/api.ts` to `hc` one domain at a time, keeping the exported function names.
      Drop the hand-written response types and the `str`/`num`/`list` fallbacks each domain no longer
      needs. `api.ts` went from 505 to 374 lines; what is left of the parsers reads the SSE list frames
      (`sessionsEventOf`) and the two raw answers. `web/src/sdk/actions.ts` stays on `fetch`: an action's
      result is `unknown` by design (its ref parses it), and `hc` does not encode a path parameter.
    - [x] sessions: `refactor(web): move the session calls to the typed client` (`d3dcd59`). `GET /api/sessions`
          and `GET /api/history` stay raw writes, so `listSessions` and `fetchHistory` keep their
          parsers (`sessionsOf` is also what reads the `sessions` frame of the SSE list). `hono/compress`
          does not keep the behaviour: `c.json` sets no `Content-Length`, so its threshold never
          applies and a 15-byte body is gzipped; it ignores `q` values (`gzip;q=0, *` gets `deflate`
          where `answer()` sends plain). Measured on Hono 4.13.16.
    - [x] models: `refactor(web): move the model calls to the typed client` (`7c7fb26`). `Models` is the
          inferred answer, except that `default` may be `null` before the first answer.
    - [x] files: `refactor(web): move the file calls to the typed client` (`bf9a59b`). The upload stays a raw
          body through `hc`'s `init.body` (the file is not copied: `deepMerge` assigns it); the two
          `/api/uploads?path=` strings are one `uploadUrl()`.
    - [x] conversation: `refactor(web): move the conversation calls to the typed client` (`9de873f`). The two
          stream paths and the entry-image URL come from `$path()`; `fetchHistory` keeps `parseHistory`
          (raw route). `AgentBody`'s level uses the same `ThinkingLevel` as the default model's.
    - [x] extensions: `refactor(web): move the extension calls to the typed client` (`a2b37af`). The two
          extension routes answered a caught failure with a raw write, which made their whole answer
          `unknown` to `hc`; they now answer `c.json(failureOf(...))`. Two browser fakes answered
          `/api/extensions` with `{}` and now answer its real shape.
    - [x] health, build, restart: `refactor(web): move health, build and restart to the typed client` (`15daf67`).
          `json()`, `post()` and `str()` are gone; `api.ts` keeps `num`/`list` for the stream frames.
- [x] SSE stays on `EventSource`; its paths come from the client's `$path()` (`sessionsStreamPath`,
      `conversationStreamPath`), not `$url()`: that one returns an absolute `URL`, and an
      `EventSource` takes the same-origin path as it is.
- [x] Stale bundle after a server restart: checked, and nothing is done. A navigation to `/` goes to
      the network first (`web/sw.js`) and `index.html` is `no-cache`, so a reload always gets HTML
      and hashed `/assets/*` from the same build; the worker has no `skipWaiting`, and an asset
      missing from the old precache comes from the network. What can mismatch is a tab that stays
      open across a restart: nothing reloads it (only `rebuildShell` offers a Reload), so old
      JavaScript talks to the new server over the same `EventSource`. That is no new gap, but
      typed answers make it louder: the old `str`/`num`/`list` fallbacks turned a changed shape into
      empty values, `hc` now trusts the shape and a missing field is `undefined` or a `TypeError`
      (the two browser fakes that answered `{}` for `/api/extensions` showed it). Closing it takes a
      build id in the `hello` frame and a reload when it changes, which is more than a line. Left
      until a route shape changes while a tab is open.
- [x] Independent review of `c008dcb..10a4c4c`: no blockers, two P2 findings, both fixed. Four browser
      fakes still answered `{}` to routes the typed client reads (`/api/extensions`, `/api/skills`, and
      the like), so the shell sat waiting while the tests passed: the fakes now share
      `test/fixtures/api-defaults.ts`, one real empty shape per route (`a1f9502`). And
      `test/api-client.test.ts` pinned only some requests: every function's URL, method, headers and body
      is now asserted, the session-scoped ones against a session that is not the root one, and
      `rebuildShell` against a recording fake so no build overwrites `dist/` (`ee0dab7`). Each assertion
      was checked by changing the request in `api.ts` and watching a test fail.
- [x] IDE type-check time: `tsc --noEmit` took 1.1-1.3 s before and 1.1-1.2 s after (TypeScript 7),
      so one client over `AppType` stays. The entry chunk is 48.2 kB gzipped both ways.

## Phase 4: pi 1.5

Details and the code impact list: [pi-1.5-migration.md](pi-1.5-migration.md). Live check on a database written by 1.4: it opens on 1.5, `/api/history` and the
`hello` of its session are whole.

- [ ] The owner's step: stop the **main** server and copy the **main** repo's `data/state.sqlite` (with
      `-wal`/`-shm`) before it first starts on 1.5, after the merge. 1.5 migrates 1.4 data on read; 1.4
      cannot read what 1.5 wrote. This worktree's own `data/` is empty and was not backed up. Never
      start a server on a copy taken from a running server: it resumes the runs in flight and runs
      their tools for real ([pi-1.5-migration.md](pi-1.5-migration.md), step 1).
- [x] Bump `pi-durable`, `pi-ai`, `pi-coding-agent`, `chord`, and the two that ride with them, `pi-codemode` and
      `pi-mcp`, to 1.5.0 together, pinned exactly: `7201235`, with the next three bullets.
- [x] Keep `typebox` as a direct dependency where extensions import it (replaced in Phase 5); fix the `Type` import from
      `pi-ai` in two files, `extensions/context-meter/server.test.ts:5` (also `:111`) and
      `test/session-prompt.test.ts:12` (also `:71`, `:77`), with plain JSON Schema objects
      (`{ type: "object", properties: {} }`): no new dependency.
- [x] Rewrite `viewState` to `Conversation.watch` in place in `server/main.ts`; adapt `publish()` to
      the windowed view (50 entries, trimmed past 100).
- [x] Found by `test/live-frames.test.ts`: 1.5 shows a streamed call's arguments as parsed, and every live
      frame carried them whole again (104 KB of live frames for a 20 KB call, 55 KB on 1.4). The last
      block of a streamed message, if it is a call, goes out with `{}` until the answer moves past it.
- [x] `subscribeCommits` to `observeCommits` (`server/new-conversations.ts`); `onReport(report)`
      with `kind` (`server/main.ts`); `compactionFailure.reason` to `trigger`.
- [x] Done with a new host member, `host.sessionContext(session)` (the conversation's `context().entries`,
      read when the popover asks), so the meter measures the whole context again; a commit's `entries`
      stays the window and its type says so — `44aae64`. The meter had summed its breakdown over
      `view.entries`, which in 1.5 is a window of 50 to 100 entries.
- [x] `hello` byte cut kept (a window of 100 entries is not bounded in bytes); `docs/server.md` rewritten for
      the window — `2f40983`.
- [x] Replace `hasOlder` and the retry loop in `stream()` with `view.before` — `4c695a5`.
- [x] `bash-timeout`: a test that `afterTool` on an `invalid_arguments` result with no memo says nothing —
      `692a4e9`.
- [ ] Optional: show `pi.live.runFailure` in the transcript, so a failed run is not silent. Since 1.5 a
      run cut off by the restart limit or an interrupted model request ends idle, and
      `extensions/finished/web.tsx` (~64–99) chimes its success notice on that idle transition; it
      should read the failure too.
- [x] Smoke test on 1.5. A fresh database with the owner's logins: a bash tool call streams, commits
      with its arguments, and the context meter shows the whole context. A copy of the owner's
      database (779 sessions, 620 MB) with `HOME` pointed at an empty folder: the list loads, the
      largest sessions open with a `hello` of 49–86 KB (50 entries, `more`), and older pages load back
      to the first message.
- [x] Review of phase 4 (`411e023..50ab731`): no blocker. The cache-hit tooltip now says it covers the
      recent answers. Known limit kept in `docs/server.md`: one watch call appending more than 50
      entries would leave a gap in the stream; nothing in the app writes that many today.

## Phase 5: TypeBox to pi-schema (optional)

Details: [pi-schema-migration.md](pi-schema-migration.md). One extension per step, smallest first; the
last step removes `typebox`. The gain is one dependency fewer and alignment with upstream, nothing
functional. Each switch is preceded by a test that pins the schema the tool installs (pi-ai still converts it per
provider). Review of `56126f4..17e581b`: no blocker. Live check on a fresh database, every request
carrying all tools with the two changed schemas: openai `gpt-6.1-sol` (and an `mcp` call with `{}`
through the new validation), anthropic `claude-haiku-5-5`, opencode-go `deepseek-v4.1-flash` and
kiro-acp `claude-haiku-4.5` all answered. `local` and `simplex` were not tried.

- [x] Test-only schemas (`bash-timeout`; the other two test files already had none).
- [x] `web-fetch`
- [x] `mcp` (`Record` became `map`: the JSON changed, the accepted arguments did not)
- [x] `web-search`
- [x] `subagents`
- [x] `browser` (a Union of Literals became `union` of `lit`: the JSON changed, the accepted actions did not)
- [x] Remove `typebox` from every `package.json` and the lockfile: it left with each extension. The
      lockfile keeps one `typebox@1.3.27`, owned by `@earendil-works/pi-coding-agent`.

## Phase 6: split the server

- [ ] `server/main.ts` (993 lines) becomes the composition root only: the conversation stream and the
      session-list stream move to `server/streams/`.
- [ ] `server/extensions.ts` (1314 lines) becomes `server/extensions/`: contract, loader and watcher,
      host construction, version tracking. Split by state ownership, not by method, or the coupling
      only moves.
- [ ] Cut the upward imports: `server/http.ts` imports `ActionError`/`ActionNotFound` from
      `extensions.ts`; `server/sessions.ts` imports all of `projection.ts` for the first question;
      `routes/conversation.ts` imports `IMAGE_TYPES` from `routes/files.ts`.
- [ ] `server/projection.ts`: entry projection apart from live projection, if it still reads as two
      things after phase 4.

## Phase 7: split the web shell

One file per step, largest mixing first:

- [ ] `transcript/transcript.tsx` (15 components): user message, answer header and notices,
      compaction marks, turn view, the scrolling list.
- [ ] `transcript/activity.tsx` (9 components).
- [ ] `shell/sessions.tsx` (1366 lines): row, rename form, filter state, resize and gestures.
- [ ] `composer/composer.tsx` (881 lines): completion, drag and drop, the send toolbar.
- [ ] `App.tsx` (693 lines): navigation and panel coordination into hooks.
- [ ] `shell/folder-picker.tsx`, `shell/sessions-status.tsx`, `shell/appearance-dialog.tsx`,
      `ui/diff.tsx`, `ui/markdown.tsx`.
- [ ] `lib/turns.ts` (705 lines): only if a split reads better; it is pure logic.

## Phase 8: extensions

Every extension gets the same layout, so a reader knows where a file is before opening the folder.
Today each one grew its own shape: `browser/lib/`, `web-search/fixtures/`, `details.tsx` beside
`account-details.tsx`, `panel.tsx` beside `todos.tsx`, up to 30 files at the top of `git-history/`.

### The layout

```text
extensions/<name>/
  package.json     name `@pi-durable-agent/<name>` and the extension's own dependencies
  README.md        usage, configuration, behaviour and limits; every extension has one
  server.ts        entry, found by the server loader by name
  server.test.ts   tests of what server.ts installs
  web.tsx          entry, found by the browser glob by name
  details.tsx      entry, found by the Extensions dialog glob by name
  refs.ts          the contract between the halves: action refs, shared types, parsers;
                   browser-safe, no Node imports
  server/          server-only code server.ts imports; Node APIs allowed; tests beside the file
  web/             browser-only code web.tsx and details.tsx import: one exported component per
                   file, hooks in use-*.ts, browser helpers; tests beside the file
  assets/          fonts, icons, scripts and other files read by path
  fixtures/        test data
  LICENSE.*        notices for copied code, kept beside the code they cover
```

Rules:

- **The top level holds only the names above.** Every other file goes into `server/` or `web/`. The
  three entries are found by name, so they cannot move; everything else can, and putting it in a
  folder named after its runtime keeps it there.
- **The folder says where the code runs.** `server/` may import Node; `web/` is bundled by Vite and
  must not; `refs.ts` is imported by both. A Node import reaching the browser bundle is the mistake
  this prevents, and it is the one Vite reports late.
- **Entries only wire.** `server.ts` builds the tools, prompt sections, hooks and actions from
  `server/`; `web.tsx` and `details.tsx` register components from `web/`. Logic lives in the folders.
- **Optional parts stay absent.** A server-only extension has no `web.tsx` and no `web/`; an empty
  folder is never created.
- **Shared code is `refs.ts`.** If it outgrows ~300 lines it becomes a `shared/` folder, imported by
  both halves; not before.

### Steps

- [ ] Core: check that the loader reinstalls an extension when a file in `server/` changes, and does
      not reinstall it for a change in `web/`, `assets/` or `fixtures/` (today it only skips
      `web.tsx` and test files). Fix the watcher filter if not, with a test.
- [ ] Core: check that the module resolve hook versions helper imports in subfolders, so a reload
      picks up an edited `server/*.ts`.
- [ ] Write the layout into `docs/extensions.md`; `AGENTS.md` and `docs/conventions.md` point to it.
- [ ] Move one extension per commit, smallest first, with `git mv` so history follows. A move commit
      only moves files and fixes imports; splitting a large file is its own commit after it.
      Order: `prompt`, `cache-hit`, `tokens-per-second`, `kiro-acp`, `image-limit`,
      `codemode`, `web-fetch`, `finished`, `pause`, `caveman`, `ponytail`, `hotkeys`,
      `context-meter`, `git-branch`, `bash-timeout`, `auto-session-name`, `files`, `terminal`,
      `notes`, `mcp`, `tags`, `usage-limits`, `keep-warm`, `git-worktree`, `web-search`,
      `dictation`, `push`, `anthropic-subscription`, `browser`, `subagents`, `git-history`.
- [ ] Add a `README.md` where it is missing: `cache-hit`, `finished`, `prompt`, `tags`,
      `tokens-per-second`.
- [ ] Decide on `subagents/HANDOFF.md`: fold into its `README.md` or delete.
- [ ] Split the large files inside the new folders:
    - [ ] `git-history/web.tsx` (1423 lines, 8 components) into `web/`.
    - [ ] `browser/lib/page.ts` (1333 lines).
    - [ ] `subagents/server.ts` (925 lines): tasks, profiles, tools, prompt into `server/`.
    - [ ] `git-worktree/web.tsx`, `browser/panel.tsx`, `terminal/panel.tsx`, `notes/todos.tsx`,
          `subagents/web.tsx`.
- [ ] A check that fails when a top-level file outside the layout appears (a test over
      `extensions/*`), so the shape does not drift back.

## Phase 9: tests and scripts

- [ ] `test/fixtures/`: one helper for a free port, a temporary `PI_DURABLE_DATA_DIR`, and a running
      test server, replacing the copies in each test file.
- [ ] `pnpm dev:web` and `pnpm dev:server` beside `pnpm dev`, so either side runs alone.
