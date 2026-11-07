# Sessions

A session is one conversation working in one folder. The list, its live state, the "seen" marks, the
row menu (rename, archive, delete) and the home page are core: an extension's web half has no access
to the list, only to the slots the shell offers ([extensions.md](extensions.md)). How the sidebar draws
the list is in [layout.md](layout.md#sidebar).

## The list

```text
GET  /api/sessions           the whole list, gzipped when the client takes it
GET  /api/sessions/events    SSE: the list as it changes (below)
POST /api/sessions           { cwd } → { session }: a new conversation with the default model
POST /api/sessions/title     { session, title }  a name by hand, cut to 80 characters; "" goes back to the first question
POST /api/sessions/archive   { session, archived }
POST /api/sessions/delete    { session }
POST /api/sessions/seen      { session }  the latest run is seen
GET  /api/folder-layout      the sidebar's folder order, folds, names and colours, from data/folders.json
PUT  /api/folder-layout      replaces it; a part that is not valid is dropped, the rest is kept
```

A row is a `SessionSummary` (`shared/protocol.ts`): `title` (what the row shows: the name set by hand,
`name`, else the first question), `cwd`, `model`, `thinkingLevel`, `busy`, `archived`, `unseen`,
`activeAt`, `endedAt`, `parent`, and the `mark` and `under` that extensions add (`server/extensions`:
`markOf`, `groupOf`). `activeAt` is when the newest run started, whoever started it, and moves again when a
person writes into a run already under way; it is kept in the `app.clock` document. `parent` is the session
that started this one (a subagent's, say); the sidebar hides such a row while its parent is listed
(`web/src/lib/session-nesting.ts`).

The session's own state is conversation documents in `data/state.sqlite`, written by `server/sessions.ts`:
`app.clock`, `app.title`, `app.archive`, `app.attention` (seen) and `app.deleted`. Each has a default, so a
session older than the document needs no migration.

## Live state

`GET /api/sessions/events` sends `{ type: "sessions", sessions }` once, when a tab connects, and after that
only `{ type: "rows", rows, gone }`: the rows that differ from what the last frame left, and the ids no
longer listed. A phone on a slow link pays for these bytes on every rename, busy flip and archive, so
the first frame is whole and every later one is a diff. All tabs hold the same list, so one diff serves
them all (`server/session-list.ts`); a row is compared as the browser holds it, by `JSON.stringify`.
The same stream carries `{ type: "extension-notice", notice }` ([Notifications](layout.md#notifications)).

`server/streams/sessions.ts` reads no more than it sends:

- A change that names its session rebuilds that one row. One that cannot name one (a new session, an
  extension's mark) reads the whole list.
- Changes in a burst (100 ms) are sent as one frame.
- While anyone watches, the whole list is read and diffed again every 30 seconds, so a row whose change
  nobody marked is late, not wrong.
- A change is: a session starts or stops working, gains the question that names it, a run starts, ends or
  is seen, or any non-`GET` API call outside `/api/extensions/` (create, rename, archive, delete, model,
  seen, a message). The entries a run appends are not changes. An extension's own change goes through
  `host.notifySessionChanged` or `host.setSessionTitle`.

The browser keeps one list (`web/src/lib/session-list.ts`, `useSessionList`) and does not poll. An
action also re-reads the list (`listSessions`), so its own result shows at once.

## Seen

The `app.attention` document holds `endedAt` (when the latest run ended) and `seenAt` (when a person last
saw the session), both on the server's clock, so a session seen on the computer is not fresh on the phone
and the marks survive a restart.

- A row is `unseen` when `endedAt > seenAt`, never while it works or is archived.
- `endedAt` is written when the run ends, before the browsers hear of it (`server/streams/conversation.ts`);
  `seen` sets `seenAt` to now. So a `seen` sent the moment a run ends always covers it.
- `endedAt` is absent in the row until a run has been seen to end, never `0`, and a working session keeps
  the end of its previous run until the new one ends.
- The browser (`web/src/lib/seen.ts`) sends `seen` for the open session while it is unseen **and** the page
  is visible and has focus. A tab left visible on a computer nobody sits at does not mark the phone's
  work as seen.

Known limit: a browser in plain sight on a second screen, without focus, marks nothing until it is clicked;
a focused browser nobody looks at marks anyway.

## Home, status bar, notices

- **Home** (`/`, `web/src/shell/home.tsx`) lists every session from every folder that is not archived and
  not nested under a parent, as `Working`, `Not viewed` and `Recent` (the newest 20). `?session=N` is a
  session; moving between them adds a history step, so Back returns home
  ([layout.md](layout.md#home)).
- **The status bar** counts the other sessions that work and the ones finished unseen, and lists them
  ([layout.md](layout.md#status-bar)).
- **Notices**: a toast when another session finishes comes from `extensions/finished`
  ([README](../extensions/finished/README.md)); an extension's own notice about a session goes through
  `host.notify`. Both appear top right and open the session on a click
  ([layout.md](layout.md#notifications)).

## Archive

Archiving hides a session from the normal list without deleting it or stopping a run. The sidebar's archive
button switches between Sessions and Archive within the selected folder; an archived session can still be
opened by link, read and restored. The home page, the status bar's counts and `unseen` leave archived
sessions out. Archiving the open session leaves its conversation open, so neither a running answer nor the
folder context is lost.

The flag is the `app.archive` document (default false); the list API returns both kinds and the browser
filters. The row's ellipsis opens a Radix dropdown menu: extension items (`sessionMenu`), then Rename,
Archive / Restore and Delete. Archive and Restore show a four-second toast with Undo; a failed write shows an
error, never a success.

## Delete

Delete is the last item of the row menu and has no way back. It asks first: a dialog over the app, titled
`Delete “<title>”?`, with No (focused) and Yes, delete; Escape or No backs out. Only then does the row leave
every list.

Deleting stops the session's run (a run left in a deleted session would go on working where nobody can see
or stop it), then writes one note: the `app.deleted` document, default false. The conversation, its entries
and its documents stay in `data/state.sqlite` exactly as they were. `Sessions.ids()` skips marked sessions,
so they are absent from the list API and from the streams, also after a restart; `Sessions.open()` refuses
them, so a stale link cannot bring one back. A session started from a deleted one, at any depth, has no row
either: the sidebar hides a child only while its parent has a row, so a surviving child would otherwise
appear as a session of its own. Extensions that hold something for the session are told through
`host.onSessionGone`.

This is a mark and not a purge. pi-durable has no delete call: conversations and entries are immutable and
`Storage` only appends, and removing rows under a running harness would write to the store behind the
library's back, where a failed commit is fatal to the session. The cost is that the bytes of an old session
stay on disk. Nothing in the UI flips the flag back, because a delete that can be undone is an archive. To
start clean, delete `data/state.sqlite`: it is the only state, and every session goes with it.
