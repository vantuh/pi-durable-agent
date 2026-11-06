# Finished runs

`extensions/finished` tells you a run has ended, in the browser. `server.ts` only installs the
extension; the work is in `web.tsx`, a status item that draws nothing.

- **A chime** when a top-level session stops working: two falling notes. It plays for the session on
  screen too. The browser lets it play only after the page has had a click or a key press, as it
  does for sending.
- **A toast** when a session that is not on screen stops working: its title and
  `Finished · <folder>`. A click on the toast opens that session.
- **Subagents give neither.** A session counts as working while its own run or any session started
  from it, at any depth, is busy (`web/finished.ts`), so a parent finishes when its last child does.
- **It waits three seconds.** A parent's report reaches it a moment after its last child goes idle;
  a session that works again within that time did not finish, and the pending signal is dropped.
- **Configuration.** None. Turn it off with its switch in the Extensions dialog.

Limits: it reads the session list the page already has, so a tab that is closed makes no sound.
The chime is not a setting; to silence it, turn the extension off.
