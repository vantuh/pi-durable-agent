# Finished runs

Tells you in the browser that a run has ended: a chime, and a toast for sessions you are not
looking at. `server.ts` only installs the extension; the work is in `web.tsx`, a status item that
draws nothing.

## Usage

- **Chime.** Two falling notes when a top-level session stops working. It plays for the session on
  screen too.
- **Toast.** When a session that is not on screen stops working: its title and
  `Finished · <folder>`. A click on the toast opens that session.

Turn it off with its switch in the Extensions dialog. The chime is not a separate setting.

## Behavior

- Subagents give neither. A session counts as working while its own run or any session started from
  it, at any depth, is busy (`web/finished.ts`), so a parent finishes when its last child does.
- It waits three seconds. A parent's report reaches it a moment after its last child goes idle; a
  session that works again within that time did not finish, and the pending signal is dropped.
- The browser lets the chime play only after the page has had a click or a key press.

## Limits

It reads the session list the page already has, so a closed tab makes no sound.
