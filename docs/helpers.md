# Helpers: one home for each repeated function

A plan, tracked here until it is done. The UI pass ([ui-primitives.md](ui-primitives.md)) gave every
repeated look one home; this does the same for repeated functions across `server/`, `shared/`,
`web/src`, and `extensions/`.

Written from a family-by-family audit at `63d0239` (type guards and error text; JSON files, queues and
paths; processes, HTTP and timers; formatting, ordering and browser persistence). The audit searched by
code shape, not by name, so a copy under another name counts; it is a map of the repeats that matter,
not a list of every function in the repository.

## Rules

- **A helper moves to the core only if it is about no one extension** (AGENTS.md). Extensions never
  import each other, so a helper two extensions share goes to the core or stays copied.
- **Where it goes**: code both sides run (`refs.ts`, the server, the browser) → `shared/`; server-only →
  `server/`, exported to extensions through `server/sdk.ts`; browser-only → `web/src/lib/`, imported
  as `@/lib/…`.
- **Same behaviour, or say what changed.** A copy whose edge cases differ (null, arrays, a missing file)
  is either proven equivalent at its call sites or keeps its own name with the reason.
- **One commit per item**, `pnpm check` after each, `pnpm test` at the end of the phase; a core change
  names its reason in the commit message.

## Items

### 5.1 Unknown values and error text → `shared/`

- [x] `isRecord` (a non-null, non-array object) had twenty-four copies: `server/http.ts` (`record`),
      `server/projection.ts` (`recordOf`), `server/extensions/extensions.ts` (`isRecord`, accepts arrays),
      `web/src/lib/api.ts` (`record`), and the extensions' own — `usage-limits` (readers, refs),
      `dictation/store`, `push` (store, completion, subscription, refs), `keep-warm/refs`,
      `web-search/wire`, `mcp/connections`, `anthropic-subscription` (account-refs, refs); `files/refs`,
      `browser/refs`, `subagents/refs` accept arrays. Done: `isRecord` and its value form `recordOf` live
      in `shared/guards.ts`, and all twenty-four call them — the audit missed `web/src/lib/provider-error.ts`
      (`record`), `dictation/http.ts` (`record`), `usage-limits/readers.ts`'s second copy, and the throwing
      `object` of `mcp/refs.ts` and `git-history/refs.ts`. The ones that accepted arrays now refuse them,
      which changed nothing: every call site reads keys an array does not have. The five that returned a
      copy of the object no longer do, because no caller mutates what it is handed. `web-search/wire.ts`
      keeps its `record` as a one-line adapter over `isRecord`: it answers `{}` rather than `undefined`,
      and twenty-four call sites read through it.
- [x] Error to text (`error instanceof Error ? error.message : String(error)`) had twenty-three copies:
      `server/extensions/extensions.ts` (`reasonOf`), `extensions/browser/lib/errors.ts` (`describe`; the file is
      gone), `extensions/git-history/web.tsx` (`errorText`), and the same expression inline across server
      and extension catch sites — plus, missed by the audit, `mcp/connections.ts` (`errorText`),
      `auto-session-name/server.ts` (`errorMessage`), `dictation/record.ts` (`messageOf`, exported to two
      browser files) and `files/panel.tsx` (`message`). Done: `shared/guards.ts` holds one `messageOf`
      beside `isRecord`, since both read an `unknown`, and every copy calls it. `git-history/git.ts` and
      `web-search/chain.ts` keep their helper — `gitMessage` prefers Git's stderr, `reasonOf` cuts to one
      line first — and take the text from `messageOf`. The thirty-one call sites whose fallback names the
      failure (`"the request failed"`, `"Something went wrong."`, a `fallback` parameter) keep their own
      expression, and so does `git-worktree`'s `describe`, which prefers Git's stderr to the message.

### 5.2 JSON files through the core's atomic writer

- [x] **Writers.** Every JSON file a store keeps is written by `writeJsonFile` / `writeFileAtomic`
      (`server/atomic-write.ts`, through `server/sdk.ts`): a temporary file beside the target, a rename,
      a queue per path, the parent folder made. The audit named ten stores; four of them still wrote
      their own way and are the ones this item changed — `git-worktree/remembered` (its own temp and
      rename, no folder), `mcp/connections` (`mkdirSync` + `writeFileSync`), `browser/server` (the same,
      from a page's debounce timer, so a failure now goes to `host.log` instead of nowhere) and the
      core's favourites in `server/routes/files.ts` (a plain `writeFile`). The other six had been
      written through the core since they were built and needed nothing: `dictation` and `push`
      (`0600`), `auto-session-name`, `usage-limits`, `keep-warm`, `tags` — the audit was reading an
      older tree than the code. Two of the four needed more than the writer. `mcp`'s save stopped
      being atomic the moment it was awaited: two switches could both read the file before either
      wrote it, so its read and its write run in one queue of their own (below). `browser`'s save was a
      promise nobody held, and the server exits right after the extension is disposed, so the store
      keeps its last write and the disposal awaits it — a page's address was otherwise lost by the
      exit rather than by the write.
- [x] Nothing wanted pretty JSON: every one of these files is on disk as one compact line already, so
      `WriteOptions` gained no `space`, and the only change to what a file holds is the newline
      `writeJsonFile` appends — no reader looks at bytes. Two writes that are not JSON files stay: an
      uploaded file (`writeFile(…, { flag: "wx" })`, and the flag is what keeps two uploads of one
      name apart, which a rename cannot carry) and `subagents` writing a profile's Markdown through
      `writeFileAtomic`.
- [x] **One queue for a change.** `push/store`, `tags/store`, `mcp/connections` and `notes` serialise
      a _change_, not a write: the file is read, changed and written inside the queue, and the
      core's queue holds the write alone, so the read before it would still race. They share
      `serialize(key, work)` (`server/keyed-queue.ts`, through `server/sdk.ts`), which runs the work
      for a key one piece at a time, survives a rejected piece, drops a key once its work is done, and
      keeps its map in `globalThis` under a symbol, so a reloaded version waits for the save its old
      version started. The key is the file's path; `notes` keys the whole notes folder, since its
      first read writes the to-do file and the note together and changes must run in arrival order.
      `writeFileAtomic` keeps its own writer queue: a change holds the keyed queue while it writes,
      and the writer must not wait on it.
- [x] **Readers.** `readJsonFile` in `server/json-file.ts`, exported through `server/sdk.ts`, is the
      read: the value, or `undefined` when the file is missing or does not hold JSON. Anything else —
      a folder where the file should be, no permission — is thrown, because that is a mistake and not
      an empty store. Nine files call it and lost their `try { JSON.parse(await readFile(…)) } catch`:
      `auto-session-name`, `bash-timeout`, `git-worktree`, `hotkeys`, `keep-warm`, `tags`,
      `usage-limits`, and the core's extensions list and favourites. Their shape checks and fallbacks
      are unchanged; what changed is that a data file that is there but unreadable is no longer read as
      empty — a broken store used to look exactly like an empty one.
- [x] Five reads keep their own, because `undefined` is not an answer they can take: `dictation` and
      `push` must not replace a file they cannot read (missing means the defaults, broken is an error
      that leaves every subscription alone, so they still tell the two apart), `mcp`'s config reader
      reports a broken `mcp.json` in `list`'s `problem`, `browser` reads synchronously while its store
      is built and handed to a running Chromium, and `notes` must seed a missing to-do list from the
      note while a broken one is an error. Outside the stores, `usage-limits` reads Codex CLI's own
      `~/.codex/auth.json`, where any failure at all means "no Codex usage" and a throw would surface
      as a provider error.

### 5.3 The dictation extension's HTTP helpers

- [x] `extensions/dictation/http.ts` restated `readJson`, `answer`, and `answerError` from
      `server/http.ts`, with a 4 MiB body limit and its own `HttpError`. Done: the file is gone, and the
      routes call the core's `readJson` (the limit is now a parameter, `MAX_BODY` staying the 100 MB
      default), `answer` and `answerError` through `server/sdk.ts`. The one thing the core could not say
      was a status of someone else's choosing, so `server/http.ts` gained `HttpError` — a message and a
      status — and `answerError` answers with it ahead of `ActionNotFound` and `ActionError`; a route
      that catches its own body errors names the status it wants. Dictation's statuses are the ones it
      had (200, 413, 400, 404, 503); the two body refusals now carry the core's wording, and a test
      covers the 400 that had none.

### 5.4 Tokens and cost read the same everywhere → `web/src/lib/format.ts`

- [x] The transcript (`tokens`, `dollars`) and the composer's stats (`compact`, `money`) show the same
      numbers with different rules; `extensions/context-meter/web.tsx` (`compact`, `percent`) and
      `extensions/keep-warm/web.tsx` (`tokens`) add two more. Done: `web/src/lib/format.ts` holds
      `tokens` and `cost`, on the transcript's rules with the two things the copies had and everyone
      wanted — `M` for millions (a context window is a million tokens) and `$0` for nothing spent —
      and one thing all four disagreed about: a trailing `.0`, so a count of 5000 is `5k`, not `5.0k`.
      One decimal of k under ten thousand, whole k to a million, and a rounding that reaches the next
      unit says it there: 999_999 is `1M`, not `1000k`. Prices are `$0`, three decimals under a dollar
      (`$0.135`), two from it (`$19.84`). Every copy calls them — the transcript, the composer, and
      `context-meter`, `subagents` and `keep-warm` — and so does a fifth found while doing it,
      `web/src/composer/model-menu-dialog.tsx`, which printed a model's window as `1000k`.
      `test/format.test.ts` pins the boundaries. Kept where they were: `percent` stays in
      `context-meter` (a share of the window, and its two callers are the meter and the readout beside
      it), `usage-limits` counts percent 0 to 100 rather than 0 to 1, and `tokens-per-second` formats a
      rate on the server, where `web/src/lib` is out of reach.

### 5.5 Small browser repeats

- [x] `newestFirst` is written twice, in `web/src/lib/status-rows.ts` and `web/src/shell/home.tsx`.
      Done: the two copies were the same comparison — `activeAt` descending, a session never worked in
      last — so it lives in `web/src/lib/session-order.ts`, and `test/session-order.test.ts` pins the
      null. The two inline copies in `shell/sessions.tsx` were that comparison too: the sidebar's
      `newest`, and the search's sort, which leads with the match score and so takes `newestFirst` as
      its second key. `session-folders.ts`'s `byLastUse` stays its own: equal times there break by
      path, so rows do not swap.
- [x] `extensions/keep-warm/web.tsx` has its own `ago` beside the core's `web/src/lib/time.ts`; use the
      core's, accepting its wording ("now" for "just now"). Done: the copy is gone, and the line reads
      `Last ping {ago(warm.last.at, now)}` — "Last ping 3m", "Last ping now", "Last ping 6d", a date
      past a week — where it said "3 min ago", "just now" and "144 h ago". The bare unit is how the
      rest of the shell writes relative time, and it is the only wording that reads with all of `ago`'s
      answers. `clock` (absolute time) stays as it was.

### Kept separate, with the reason

- **Git runners** in `git-history`'s `git.ts` and `stats.ts`: different timeouts and exit-code
  handling, and no shared home without a core git API nobody else needs.
- **Processes, timers, cancellation**: each is shaped by its task (build output, Chromium's lifetime,
  Kiro's process group, the bash idle guard); one helper would hide the differences that matter.
- **Safe `JSON.parse`**: the request body (`server/http.ts` answers 400), SSE frames, and browser
  storage each treat bad JSON on purpose, and `dictation`, `push`, `mcp`, `browser` and `notes` keep
  their own read of a store's file for the reasons under 5.2.
- **Browser persistence** (sidebar and panel widths, sidebar height, enum preferences): keys, fallbacks,
  and side effects differ; a generic storage wrapper would hide them.
- **Relative time in `subagents`**: it runs on the server, where `web/src/lib/time.ts` is out of reach,
  and its words ("finished", "just now") are its own.
- **The two `EventSource` hooks** (`conversation.ts`, `session-list.ts`): they share `reopenDelay`
  already; the rest is their own event handling.
