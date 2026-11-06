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
| Browser types    | `web/` may `import type { AppType }` from `server/` for `hc`, and nothing else from `server/`. The rule in `AGENTS.md` is relaxed in phase 3, not before.                                                                                                        |
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

- [ ] Export `AppType` from the server; relax the `web/` import rule in `AGENTS.md` to `import type`
      of `AppType` only.
- [ ] Move `web/src/lib/api.ts` to `hc` one domain at a time: sessions, models, files, conversation,
      extensions. Drop the hand-written response types and the `str`/`num`/`list` fallbacks each domain
      no longer needs.
- [ ] SSE stays on `EventSource`; build its URLs with `$url()`.
- [ ] Stale bundle after a server restart (PWA in `web/sw.js`): reload when the build changes, or keep
      a Zod parse on the few answers that matter. Check first whether it happens at all.
- [ ] Watch the IDE type-check time; split into per-sub-app clients if it drags.

## Phase 4: pi 1.5

Details and the code impact list: [pi-1.5-migration.md](pi-1.5-migration.md) (being written).

- [ ] Stop the server; back up `data/state.sqlite` (with `-wal`/`-shm`). 1.5 migrates 1.4 data on
      read; 1.4 cannot read what 1.5 wrote.
- [ ] Bump `pi-durable`, `pi-ai`, `pi-coding-agent` and `chord` to 1.5.0 together, pinned exactly.
- [ ] Keep `typebox` as a direct dependency where extensions import it; fix the one `Type` import
      from `pi-ai` (`extensions/context-meter/server.test.ts`).
- [ ] Rewrite `viewState` to `Conversation.watch` in place in `server/main.ts`; adapt `publish()` to
      the windowed view (50 entries, trimmed past 100).
- [ ] `subscribeCommits` to `observeCommits` (`server/new-conversations.ts`); `onReport(report)`
      with `kind` (`server/main.ts`); `compactionFailure.reason` to `trigger`.
- [ ] Replace `hasOlder` and the retry loop in `stream()` with `view.before`.
- [ ] Optional: show `pi.live.runFailure` in the transcript, so a failed run is not silent.

## Phase 5: TypeBox to pi-schema (optional)

Details: [pi-schema-migration.md](pi-schema-migration.md) (being written). One extension per step,
smallest first; the last step removes `typebox`. The gain is one dependency fewer and alignment with
upstream, nothing functional.

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
