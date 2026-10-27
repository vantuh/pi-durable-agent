# Sessions, live, on every device

Sessions run in many folders, but the sidebar shows one folder and only the open session streams.
This is the plan to see every session's state from anywhere, in four steps, each its own change:

1. **The list streams, and "seen" lives on the server.** (this document's detail)
2. **A home page**: every session from every folder, working first, then unseen, then by time.
   Reached from a favicon button in the sidebar header; `/` is home, `?session=N` is a session,
   kept in sync with `history.pushState` so Back on a phone goes home.
3. **In-app notifications**: a toast when another session finishes; a click opens it.
4. **The status bar counts the others**: `ready · 2 working`, a click lists them.

All of it is core: the session list and the sidebar are core, and an extension's web half has no
access to the list.

## The list streams

```text
GET  /api/sessions/events    SSE: { type: "sessions", sessions } at once, then after every change
POST /api/sessions/seen      { session }  the latest run is seen
```

The list is sent whole, not as deltas: it is a few dozen rows, and a whole list cannot drift.
Changes in a burst are sent once. A change is: a session starts or stops working, gains or loses
entries (its title and time come from them), or any non-`GET` API call (create, rename, archive,
delete, model, seen, a message). The browser drops its polling and its re-reads after each action.

## Seen

Per conversation, the `app.attention` document holds `endedAt` (when the latest run ended) and
`seenAt` (when a person last saw the session), both on the server's clock. It replaces the
browser's `localStorage`, so a session seen on the computer is no longer fresh on the phone, and
the marks survive a restart.

- A row is `unseen` when `endedAt > seenAt`, and never while it works or is archived.
- `endedAt` is taken when the run ends, before the browsers hear of it; `seen` sets `seenAt` to
  now. So a `seen` sent the moment a run ends always covers it, whatever order the writes land in.
- The browser sends `seen` for the session on screen when it is opened, when its run ends, and
  when the window comes back (`focus`, `visibilitychange`), but only while the page is visible
  **and** has focus. A tab left visible on a computer you walked away from does not mark the
  phone's work as seen.

Known limits: a browser in plain sight on a second screen, without focus, does not mark a session
until it is clicked; a focused browser nobody looks at marks it anyway.
