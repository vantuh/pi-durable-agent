# Session names

`extensions/auto-session-name` names a conversation from what it was about. Ported from the Pi
extension of the same name, which carries Pi Web's "generate name" policy: the whole conversation
under a character budget, the session's model, strict title parsing, and no fallback — a failed run
leaves the name alone instead of naming the session after a fragment of the user's own message.

- **The transcript.** `lib.ts` keeps the policy verbatim: 800 characters of each user turn, 300 of
  an intermediate reply and 600 of the newest, 6000 across the session with 40% reserved for the
  opening turns (a session states its goal early and then drifts into chores), tool calls and their
  results dropped, both ends kept and the middle elided. It reads the conversation's model context
  from `sessionRequest`, typed as pi-ai's `Message`: this copy has no branch for the roles only a Pi
  session record has (`bashExecution`, `compactionSummary`, `custom`), because a compaction reaches
  this app's model as the user message that carries its summary. That type is imported rather than
  restated, so a message shape that changes upstream breaks the file instead of passing silently.
- **The request.** The session's model at the cheapest thinking level it supports (Gemini's
  unsupported `minimal` skipped), 512 output tokens shared with the reasoning, no prompt cache,
  a fresh random session ID instead of the conversation's — too small to reuse a prefix or to warm
  one — and a 90-second abort. Its own system prompt, one user message, the harness's fetch wrappers
  shaping it like any other request.
- **Automatic, off by default.** `details.tsx` in the Extensions dialog turns it on; the setting is
  `auto-session-name.json` in the data directory. Then a run that ends names its session **only while
  the session has no name** — `sessionName`, not `sessionTitle`, because the first question is not a
  name. A name set by hand is never replaced, and neither is one this extension set, so it happens
  once per session. A failed call changes nothing and the next settle tries again.
- **The menu item.** "Generate name" in a session row's menu is the explicit path, and the only one
  that replaces a name: it keeps a name that landed while the title was generating, and says so.
- **What it names.** The title lands in `app.title` through `setSessionTitle`, so the sidebar, the
  header and every extension that asks `sessionTitle` see it. Clearing the name by hand returns the
  session to its first question, and turns automatic naming on for it again.
