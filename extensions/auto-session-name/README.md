# Session names

Names a conversation from what it was about, after a run or from its menu. A failed run leaves the
name alone; there is no fallback to a fragment of the user's own message.

## Usage

- **Automatic naming** is off by default. Turn it on in the Extensions dialog (`details.tsx`). Then a
  run that ends names its session only while the session has no name (`sessionName`, not
  `sessionTitle`, because the first question is not a name). A name set by hand is never replaced,
  and neither is one this extension set, so it happens once per session. A failed call changes
  nothing and the next settled run tries again.
- **"Generate name"** in a session row's menu is the explicit path, and the only one that replaces a
  name. It keeps a name that landed while the title was generating, and says so.
- Clearing the name by hand returns the session to its first question and turns automatic naming on
  for it again.

## Configuration

The on/off setting is `auto-session-name.json` in the data directory.

## Behavior

- **The transcript.** `server/lib.ts` sends 800 characters of each user turn, 300 of an intermediate
  reply and 600 of the newest, 6000 across the session with 40% reserved for the opening turns.
  Tool calls and their results are dropped; both ends are kept and the middle is elided. It reads the
  conversation's model context from `sessionRequest`, typed as pi-ai's `Message`.
- **The request.** The session's model at the cheapest thinking level it supports (Gemini's
  unsupported `minimal` is skipped), 512 output tokens shared with the reasoning, no prompt cache, a
  fresh random session ID, and a 90-second abort. It has its own system prompt and one user message.
- **The title** is parsed strictly and lands in `app.title` through `setSessionTitle`, so the
  sidebar, the header and every extension that asks `sessionTitle` see it.

The naming policy is ported from the Pi extension of the same name (Pi Web's "generate name").
