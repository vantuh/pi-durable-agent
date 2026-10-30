# Sessions, live, on every device

Sessions run in many folders, but the sidebar shows one folder and only the open session streams.
This is the plan to see every session's state from anywhere, in four steps, each its own change:

1. **The list streams, and "seen" lives on the server.** (this document's detail)
2. **A home page**: every session from every folder, working first, then unseen, then by time.
   Reached from a favicon button in the sidebar header; `/` is home, `?session=N` is a session,
   kept in sync with `history.pushState` so Back on a phone goes home.
3. **In-app notifications**: a toast when another session finishes; a click opens it.
4. **The status bar counts the others**: `ready · 2 working · 1 new`, a click lists them, the open
   session highlighted. See [layout.md](layout.md).

All of it is core: the session list and the sidebar are core, and an extension's web half has no
access to the list.

## The list streams

```text
GET  /api/sessions/events    SSE: { type: "sessions", sessions } at once, then after every change a row shows
POST /api/sessions/seen      { session }  the latest run is seen
```

The list is sent whole, not as deltas: it is a few dozen rows, and a whole list cannot drift.
Changes in a burst are sent once. A change is: a session starts or stops working, gains the question
that names it, a run ends, or any non-`GET` API call (create, rename, archive, delete, model, seen, a
message). The entries a run appends are not changes: a row's `activeAt` is what a message sets, not
what a commit appends, and a title only the first question moves. The browser drops its polling; an
action still re-reads the list, so its own result shows at once.

## Seen

Per conversation, the `app.attention` document holds `endedAt` (when the latest run ended) and
`seenAt` (when a person last saw the session), both on the server's clock. It replaces the
browser's `localStorage`, so a session seen on the computer is no longer fresh on the phone, and
the marks survive a restart.

- The list row carries `endedAt` too, so a screen can say how long ago a session finished. It is
  absent until a run has been seen to end, never `0`, and a working session keeps the end of its
  previous run until the new one ends. `activeAt` is not this time: it moves when a person writes.
- A row is `unseen` when `endedAt > seenAt`, and never while it works or is archived.
- `endedAt` is taken when the run ends, before the browsers hear of it; `seen` sets `seenAt` to
  now. So a `seen` sent the moment a run ends always covers it, whatever order the writes land in.
- The browser sends `seen` for the session on screen when it is opened, when its run ends, and
  when the window comes back (`focus`, `visibilitychange`), but only while the page is visible
  **and** has focus. A tab left visible on a computer you walked away from does not mark the
  phone's work as seen.

Known limits: a browser in plain sight on a second screen, without focus, does not mark a session
until it is clicked; a focused browser nobody looks at marks it anyway.
