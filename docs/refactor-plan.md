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

- [x] `server/main.ts` (993 lines) becomes the composition root only: the conversation stream and the
      session-list stream move to `server/streams/`.
    - [x] `idOf` to `server/conversation-id.ts`, the hello page to `server/streams/hello.ts`.
    - [x] The session-list stream to `server/streams/sessions.ts`, the frame and heartbeat writers both streams
          share to `server/streams/event-stream.ts`. The stream takes `sessions` and `extensions` as
          functions: the extensions' host calls back into it, and the sessions open after the extensions
          load, so neither exists when the stream is built.
    - [x] The conversation stream to `server/streams/conversation.ts`: attach and detach, the last state and
          busy mark of each session, the `hello`, live frames and what each browser holds of them.
    - [x] The services extensions get for a session (request, context, prompt) to
          `server/extension-sessions.ts`.
    - [x] What `boot` creates (models, runtime, extensions, sessions, harness, the streams) is local to `boot`;
          only `lifecycle` and the mounted app stay at module level, because `stop` and the listener read them.
    - [x] The gates and `mountRoutes` to `server/app.ts`, so importing the app type no longer loads the module
          that starts a server. `AppType` and `test/route-inputs.types.ts` read it from there; the inferred type is
          the same (`hc` still types `/api/health` as before). The `app.fetch` the listener served before boot
          is a 503 now; `listen` admits nothing before `ready()`, so no request reaches it.
- [x] `server/extensions.ts` (1303 lines) becomes `server/extensions/`: contract, loader and watcher,
      host construction, version tracking. Split by state ownership, not by method, or the coupling
      only moves.
    - [x] The file moves to `server/extensions/extensions.ts` (a move only).
    - [x] `contract.ts`: the types an extension is handed and exports (the host, `CommitView`, `Action`, ...).
    - [x] `resolve-hook.ts`: the module hook that versions an extension's helper imports.
    - [x] `module-exports.ts` and `discovery.ts`: the readers of `server.ts`'s exports, of the folders and of
          the owner's on/off file; no state.
    - [x] `watcher.ts`: the file watch and its settle timer.
    - [x] `versions.ts`: the live version of each folder and the ones draining.
    - [x] `host.ts`: the host an extension version is handed.
    - [x] `collision.ts` and `listeners.ts`: the install check and the delivery to listeners; no state.
    - Not cut: `call` and `serveHttp` (twenty lines that read the loader's own `actions` and `http` maps),
      `statuses`, `markOf`, `groupOf`, `publish` and `forget` (they read the maps `#load` writes), and
      `#install`, `#drop` and `#build`: the install, the registration maps and the drain are one
      transition, and a file for any of them would take the loader's private maps as arguments.
    - The guards that kept `extensions/` to `server/sdk.ts` and `web/` to `server/app-type.ts` used
      `**/server/*`, which does not reach into `server/extensions/`; they are `**/server/**` now, and
      `server/http.ts` and `server/projection.ts` may not import `routes/` or `extensions/`.
- [x] Cut the upward imports (and a guard: `no-restricted-imports` on `server/http.ts` and
      `server/projection.ts`, see above):
    - [x] `server/http.ts` imported `ActionError`/`ActionNotFound` from `extensions.ts`: the two classes
          moved to `server/errors.ts`, a leaf both import. Mapping them at the route boundary would not do:
          an extension's raw HTTP calls `answerError` itself, so `failureOf` has to know them.
    - [x] `server/sessions.ts` imported all of `projection.ts` for the first question: the rule for what a
          user entry is and says moved to `server/user-entry.ts`, which `projection.ts` and `sessions.ts` both
          read (`test/user-entry.test.ts` pins that they agree).
    - [x] `routes/conversation.ts` imported `IMAGE_TYPES` from `routes/files.ts`: it moved to
          `server/image-types.ts`, which both routes import.
- [x] `server/projection.ts`: entry projection apart from live projection, if it still reads as two
      things after phase 4. Not split. After `user-entry.ts` took the text readers it is 460 lines, and the
      live half (`projectLive`, `projectUsage`, `queuedOf`, `toolsOf`, about 110 lines) calls the entry
      half's parsers: `blocksOf` for the streamed answer, `filesOf` and `authorOf` for a queued input,
      `optionalNumber` and `numberAt`. A split would put those in a third file that both import, or have the
      live file import the entry file; either way the two files would change together whenever a block, a
      file or an author gains a field.
- [x] Not cut in `server/streams/conversation.ts` (417 lines): attach, publish, the live frame and the `hello` share
      `latest`, `busy`, `clients` and the two timers, so each piece would take them as arguments. The one pure
      piece, the byte-cut page, is `hello.ts`.
- [x] Checked on a temporary data directory and a free port: under `scripts/serve.ts` `POST /api/restart`
      answers `{ ok }`, the server comes back and answers `/api/health`; started alone it answers 409.
      `pnpm test` (1032 tests, 6 new in `test/user-entry.test.ts`) spawns the real server for the stream,
      list, notice and route tests.
- [x] Independent review of phase 6: one P1 and one P2, both fixed. P1: `watch()` is a no-op while a watcher
      exists (two calls had made two watchers with a settle timer each, so one save reloaded twice and a dispose
      cancelled only the newest timer; the first fs watcher also leaked); tests in `test/extensions.test.ts`.
      P2: the `**/server/**` guard also matched an extension's own `./server/` helpers, which the phase 8 layout
      needs; the rule now lists the climbing paths (`../../server/**` up to five levels), and
      `test/lint-extension-imports.test.ts` lints a fixture folder: own `./server/` and `../server/` imports pass,
      the core loader is refused from an extension's top level, `server/` and `web/`. Limit: a file four or more
      folders deep that imports its own `server/` through `../../server/` is refused too.

## Phase 7: split the web shell

One file per step, largest mixing first:

- [x] `transcript/transcript.tsx` (15 components): user message, answer header and notices,
      compaction marks, turn view, the scrolling list. Now `transcript.tsx` (the frame), its scroll
      logic in `use-transcript-scroll.ts`, `turn/` (turn, item, user message, answer header, error
      notice), `compaction/` (three marks and their `Rule`) and `loading/` (the two placeholders).
- [x] `transcript/activity.tsx` (9 components). Now `transcript/activity/` (`activity-group`, `step-row`,
      `mark`, `step-body`, `thought-body`, `group-images`); `useNow` is `transcript/use-now.ts` and
      `formatDuration` is in `lib/format.ts`, because the answer header and the group both read them.
- [x] `shell/sessions.tsx` (1366 lines): row, rename form, filter state, resize and gestures. Now
      `shell/sessions/`: `sessions.tsx` (the list and its filtering), `session-row.tsx`, `rename-form.tsx`,
      `rename-dialog.tsx`, `sidebar-header.tsx`, `folder-menu.tsx`, five hooks (`use-sidebar-collapsed`,
      `use-session-search`, `use-session-actions`, `use-menu-runner`, `use-folder-scope`) and small
      files for what they share (`rail.ts`, `sidebar-width.ts`, `session-groups.ts`, `menu-item.ts`,
      `busy-label.tsx`). The session list rows (about 25 props) stay in `sessions.tsx`: a `SessionList`
      component would only pass them on.
- [x] `composer/composer.tsx` (881 lines): completion, drag and drop, the send toolbar. Now
      `composer.tsx` (the box, `submit`), `completion/` (candidates, `useCompletion`, the list),
      `history/` (the arrow-key history), `attachments/` (the drop overlay and its two hooks, uploads,
      the attach button), `toolbar/` (model chip, send button and its modes) and `queued-actions.ts`.
      `submit` stays in `composer.tsx`: it reads the draft, the files, the quotes, the mode and the
      history, so a hook for it would take all of them.
- [x] `App.tsx` (693 lines): navigation and panel coordination into hooks. Now `usePanelCoordination`
      (`shell/panels/`, with `panels.tsx`, `pages.tsx` and `tabs.tsx` moved there), `useSessionHandlers`
      and `useWindowFocus` (`shell/`) and `useModelMenu` (`composer/`). `App.tsx` keeps the session list,
      the conversation, the derived `activeSession` and the layout; the derived values stay because each
      one is memoized for the components below it.
- [x] The rest of the shell, one file at a time:
    - [x] `shell/folder-picker.tsx` (704 lines). Now `shell/folder-picker/`: `folder-picker.tsx`, `row.tsx`,
          `option.tsx`, `use-favourites.ts`, `use-folder-listing.ts`, `use-offered.ts`; `crumbs` joined the
          path helpers of `folder-picker-keys.ts`. The dialog's `onKeyDown` and `onFocus` stay: they read nine
          pieces of its state and refs, so a function for them would only take all nine.
    - [x] `shell/sessions-status.tsx` (306 lines). Now `shell/sessions-status/`: `sessions-status.tsx` and
          `row.tsx`, the status row with its submenu. `Rows`, the clock around them, stays: 40 lines used once.
    - [x] `shell/appearance-dialog.tsx` (5 components). Now `shell/settings/appearance/`: `appearance-button.tsx`,
          `flavour-grid.tsx`, `width-picker.tsx`, `diff-layout-picker.tsx`, `preview.tsx`. The settings files
          (`settings`, `settings-content`, `extensions-dialog`, `extension-details`) moved into `shell/settings/`
          and `sidebar-bottom.tsx` into `shell/sessions/`, so `shell/` keeps eight files and its folders.
    - [x] `ui/diff.tsx` (336 lines). Now `ui/diff/`: `diff-card.tsx`, `counts.tsx`, `line.tsx`, `split-body.tsx` (with
          its private column), `use-tokens.ts`, `use-room.ts` and `tones.ts`.
    - [x] `ui/markdown.tsx` (270 lines). Now `ui/markdown/code-block.tsx` and `ui/markdown/components.tsx`;
          `ui/markdown.tsx` keeps `Markdown`. It re-exported `CodeBlock` for two extensions until phase 8
          pointed them at `ui/markdown/code-block.tsx` and dropped the re-export.
- [x] `lib/turns.ts` (705 lines): split, because three jobs shared one header. `turns.ts` keeps the
      types and the grouping (`turnsOf`, 282 lines); `step-summary.ts` says what a call was about and what
      it came to (`argOf`, `outcomeOf`, `summarize`, `imagesOf`); `turn-equality.ts` holds the `same*`
      comparisons the memo boundaries use. `turnsOf` calls none of the summary helpers, so no cycle.
- Review of phase 7: no blocker, no behavioural regression. One nit fixed: the width and diff pickers shared
  one row look, now owned by `shell/settings/appearance/setting-row.tsx`.

## Phase 8: extensions

Every extension gets the same layout, so a reader knows where a file is before opening the folder.
Today each one grew its own shape: `browser/lib/`, `web-search/fixtures/`, `details.tsx` beside
`account-details.tsx`, `panel.tsx` beside `todos.tsx`, up to 30 files at the top of `git-history/`.

### The layout

The layout and its rules are written in [extensions.md](extensions.md#the-layout); this plan only
lists the steps that move the extensions to it.

### Steps

- [x] Core: the loader reinstalls an extension when a file in `server/` changes. It also reinstalled
      for a `.ts` file in `web/`, `assets/` or `fixtures/` (it skipped only `web.tsx`, test files and
      names with a dot); `server/extensions/watcher.ts` now ignores those three subfolders. Test:
      `test/extensions.test.ts`, "reloads for a change in server/, and not for web/, assets/ or fixtures/". `7bf9451`
- [x] Core: the module resolve hook versions helper imports in subfolders: it matches any file under the
      same extension folder, so an edited `server/*.ts` is picked up on reload (the same test, and
      "a reload runs a changed helper, also in a subfolder"). `7bf9451`
- [x] Write the layout into `docs/extensions.md`; `AGENTS.md` and `docs/conventions.md` point to it. `ed94d73`
- [x] Move one extension per commit, smallest first, with `git mv` so history follows. A move commit
      only moves files and fixes imports; splitting a large file is its own commit after it.
      Order: `prompt`, `cache-hit`, `tokens-per-second`, `kiro-acp`, `image-limit`,
      `codemode`, `web-fetch`, `finished`, `pause`, `caveman`, `ponytail`, `hotkeys`,
      `context-meter`, `git-branch`, `bash-timeout`, `auto-session-name`, `files`, `terminal`,
      `notes`, `tags`, `usage-limits`, `keep-warm`, `git-worktree`, `web-search`,
      `dictation`, `push`, `anthropic-subscription`, `browser`, `subagents`, `git-history`.
      Moved: `web-fetch`, `finished`, `pause`, `ponytail`, `hotkeys`, `auto-session-name`, `files`, `terminal`, `notes`, `tags`, `mcp`, `usage-limits`, `keep-warm`, `git-worktree`, `web-search`, `dictation`, `push`, `anthropic-subscription`, `browser`, `subagents`, `git-history`
      Already in the layout, no commit: `prompt`, `cache-hit`, `tokens-per-second`, `kiro-acp`, `image-limit`,
      `codemode`, `caveman`, `context-meter`, `git-branch`, `bash-timeout`. `hotkeys`, `keep-warm` and
      `anthropic-subscription` also folded their shared file (`lib.ts`, `due.ts`, `account-refs.ts`) into `refs.ts`.
      `push/sw.js` moved to `assets/`; `pwa.ts` now reads it there. Commits `be1b6ea` (web-fetch) to `84fbf01`
      (git-history), one per extension, with the folds as their own commits.
- [x] Add a `README.md` where it is missing: `cache-hit`, `finished`, `prompt`, `tags`,
      `tokens-per-second`.
      `files` and `browser` had none either and got one too. `b1b752e`
- [x] `subagents/HANDOFF.md` deleted. Its two open items (bound long reports, stop agents when a
      parent is deleted) and the isolated-UI recipe are in the README's "Open work" and "Verification"
      sections; the commit list, the live-database evidence and the finished items were stale. `eaac230`
- [x] Split the large files inside the new folders:
    - [x] `git-history/web.tsx` (1429 lines, 8 components). Now 20 lines of wiring and, in `web/`: components
          `git-history-page.tsx` (236), `commit-detail.tsx` (215), `review-view.tsx`, `changes-view.tsx`,
          `history-list.tsx`, `history-toolbar.tsx`, `history-row.tsx`, `reword-form.tsx`; hooks `use-history.ts`
          (the list, the lookup of a commit the list stops short of, the idle prefetch), `use-review.ts` (the
          Plannotator poll, cancel on leaving, feedback to the composer), `use-page-keys.ts`; plain modules
          `place.ts`, `shown.ts`, `patch-cache.ts`, `prefetch.ts`, `page-button.ts`, `exact-time.ts`,
          `review-running.ts`. The two identical refresh handlers became `reload` in `use-history.ts`. `cfaa06f`
    - [x] `browser/server/page.ts` (1333 lines). Now 850. The seams that own their state or touch no state of the
          page moved out: `page-log.ts` (`PageLog`: console lines, sequence, error count), `screencast.ts`
          (`Screencast`: frames and the watchers that keep it running), `load-tracker.ts` (`LoadTracker`: loading,
          the load marks and `settle`), and the stateless `page-input.ts` (panel events to DevTools input),
          `page-capture.ts` (screenshots), `page-evaluate.ts` (running a script), with `send.ts` and `wait.ts`
          as leaves. `BrowserPage` keeps the event switch, popups, navigation and the element actions: they write
          a dozen of its fields (`#url`, `#title`, `#frameId`, `#crashed`, the timers), so cutting them would
          pass those fields around instead of separating anything. Checked with a real Chrome: a scripted run of
          every public method gave the same transcript before and after. `4bbdcf3`
    - [x] `subagents/server.ts` (925 lines). Now 59 (meta, the commit listener, `defineExtension`) and in
          `server/`: `tools.ts` (329), `tasks.ts` (171), `actions.ts` (120), `prompt.ts` (88), `child-agent.ts`,
          `strip.ts`, `docs.ts`, `answer.ts`. `profiles.ts` and `profile-model.ts` were already there. `b7b4f91`
    - [x] `git-worktree/web.tsx` (624 lines). Now 38 lines of wiring and, in `web/`: `mark.tsx` (264, the session
          title's worktree menu), `worktree.tsx` (the new-session choice), `remove-worktree-dialog.tsx`,
          `session-mark.tsx`, hooks `use-worktree.ts` and `use-worktree-choices.ts`, and `collected.ts` (the
          new-session answers). `a1d64ba`
    - [x] `browser/web/panel.tsx` (525 lines). Now `panel.tsx` (164) and, beside it, `stage.tsx`, `console.tsx`, `icon-button.tsx` and the hooks `use-page-state.ts`, `use-frame.ts`, `use-input.ts`. `530c427`
    - [x] `terminal/web/panel.tsx` (586 lines). Now `panel.tsx` (27, the empty state and the restart counter) and `shell.tsx` (450), with `terminal-theme.ts`, `control-byte.ts` (the Ctrl+C rules, pure) and `stop-dialog.tsx` cut out of it. `shell.tsx` stays over 300 lines on purpose: the xterm effect, the stop/restart state machine and the toolbar share `live`, `pending`, `terminal`, `over` and `problem`, so a hook for the effect would take seven arguments and give nothing back but those. `5a86098`
    - [x] `notes/web/todos.tsx` (460 lines). Now `todos.tsx` (169) and, beside it, `row.tsx`, `sortable-row.tsx`, `todo-details.tsx`, the hook `use-todo-list.ts` and the `Patch` type in `todo-patch.ts`. `f4491ac`
    - [x] `subagents/web.tsx` (453 lines). Now 25 lines of wiring and, in `web/`: `chip.tsx`, `agents.tsx` (the strip), `agent-row.tsx`, `agents-area.tsx`, `agents-working.tsx`, `agents-marker.tsx`, `agents-submenu.tsx`, `models-section.tsx`, the hooks `use-strip.ts`, `use-names.ts`, `use-minute.ts`, and `strip-row.ts` (the row height both views share). `65f2cb5`
- [x] A check that fails when a top-level file outside the layout appears (a test over
      `extensions/*`), so the shape does not drift back: `test/extension-layout.test.ts`. It also fails on a
      Node import in the code the browser loads. `f5ea2d2`, tightened in the review fix below.
- Review of phase 8: no blocker, no behavioural regression; one P2 fixed test-first, the browser-code check now reads every import form and rejects bare Node builtins and runtime imports of `server/`.

## Phase 9: tests and scripts

- [ ] `test/fixtures/`: one helper for a free port, a temporary `PI_DURABLE_DATA_DIR`, and a running
      test server, replacing the copies in each test file.
- [ ] `pnpm dev:web` and `pnpm dev:server` beside `pnpm dev`, so either side runs alone.
