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

- [ ] `isRecord` (a non-null, non-array object) has about fifteen copies: `server/http.ts` (`record`),
      `server/projection.ts` (`recordOf`), `server/extensions.ts` (`isRecord`, accepts arrays),
      `web/src/lib/api.ts` (`record`), and the extensions' own — `usage-limits` (readers, refs),
      `dictation/store`, `push` (store, completion, subscription, refs), `keep-warm/refs`,
      `web-search/wire`, `mcp/connections`, `anthropic-subscription` (account-refs, refs); `files/refs`,
      `browser/refs`, `subagents/refs` accept arrays. One `isRecord` in `shared/`, every copy replaced;
      the array-accepting ones checked at their call sites first.
- [ ] Error to text (`error instanceof Error ? error.message : String(error)`): `server/extensions.ts`
      (`reasonOf`), `extensions/browser/lib/errors.ts` (`describe`), `extensions/git-history/web.tsx`
      (`errorText`), and the same expression inline across server and extension catch sites. One
      `messageOf` in `shared/`; a call site with its own fallback text keeps it.

### 5.2 JSON files through the core's atomic writer

- [ ] The core already exports `writeJsonFile` / `writeFileAtomic` (`server/atomic-write.ts`, through
      `server/sdk.ts`): temp file, rename, a queue per file, parent folder made. Only `notes` uses it.
      The other stores write their own way: `dictation/store`, `auto-session-name/store`,
      `git-worktree/remembered` (own temp + rename, no folder), `usage-limits/settings`,
      `keep-warm/store`, `push/store` (own queue), `tags/store` (own queue), `mcp/connections`,
      `browser/server`, and the core's own favourites in `server/routes/files.ts`. Every writer goes
      through the core's; the private queues that only serialised writes go with it.
- [ ] Readers: the same "read JSON, fall back" shape repeats, but missing-file and bad-file behaviour
      differ per store. Add one core reader only if most stores can use it unchanged; otherwise record
      why they stay.

### 5.3 The dictation extension's HTTP helpers

- [ ] `extensions/dictation/http.ts` restates `readJson`, `answer`, and `answerError` from
      `server/http.ts`, with a 4 MiB body limit and its own `HttpError`. Use the core's through
      `server/sdk.ts` (a body limit as a parameter if the core needs one), or record why it stays.

### 5.4 Tokens and cost read the same everywhere → `web/src/lib/format.ts`

- [ ] The transcript (`tokens`, `dollars`) and the composer's stats (`compact`, `money`) show the same
      numbers with different rules; `extensions/context-meter/web.tsx` (`compact`, `percent`) and
      `extensions/keep-warm/web.tsx` (`tokens`) add two more. One `tokens` and one `cost` in
      `web/src/lib/format.ts`, the transcript's rules unless a caller shows a reason; every copy
      replaced.

### 5.5 Small browser repeats

- [ ] `newestFirst` is written twice, in `web/src/lib/status-rows.ts` and `web/src/shell/home.tsx`.
- [ ] `extensions/keep-warm/web.tsx` has its own `ago` beside the core's `web/src/lib/time.ts`; use the
      core's, accepting its wording ("now" for "just now").

### Kept separate, with the reason

- **Git runners** in `git-history` and `git-stats`: two extensions, different timeouts and exit-code
  handling, and no shared home without a core git API nobody else needs.
- **Processes, timers, cancellation**: each is shaped by its task (build output, Chromium's lifetime,
  Kiro's process group, the bash idle guard); one helper would hide the differences that matter.
- **Safe `JSON.parse`**: the request body, SSE frames, browser storage, and each store treat bad JSON
  differently on purpose.
- **Browser persistence** (sidebar and panel widths, sidebar height, enum preferences): keys, fallbacks,
  and side effects differ; a generic storage wrapper would hide them.
- **Relative time in `subagents`**: it runs on the server, where `web/src/lib/time.ts` is out of reach,
  and its words ("finished", "just now") are its own.
- **The two `EventSource` hooks** (`conversation.ts`, `session-list.ts`): they share `reopenDelay`
  already; the rest is their own event handling.
