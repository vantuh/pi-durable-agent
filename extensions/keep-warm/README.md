# Keep warm

`extensions/keep-warm` renews the conversation's prompt cache while you are away, so your next
message reads the whole context at a tenth of the input price instead of writing it again. Ported
from Ultimate's `extensions/keep-warm`, with the harness seam below instead of theirs.

- **Why an hour.** Anthropic writes the prompt cache with `cache_control.ttl: "1h"` only when the
  request asks for it. The core opens the harness with `stream: { cacheRetention: "long" }`, so every
  request of every conversation asks; without it the cache dies after five minutes and no ping can
  renew it. A cache read costs 0.1× the input price and renews the hour, a write costs 1.25× (five
  minutes) or 2× (an hour), and only the new suffix is written.
- **When it pings.** A timer outside the task scheduler looks once a minute. A ping is due when the
  conversation's own last cache request is 55–60 minutes old, it has no run, it is on `anthropic`,
  and your latest input to it is under 8 hours old. A cache already past its hour is cold: a ping
  then would only pay to rebuild it.
- **What it sends.** The conversation's next context exactly as the harness would send it — pi-durable
  keeps the system sections and tool declarations inside the message stream — plus one user line
  asking for `ok`. Nothing is written to the transcript, and nothing is queued: the request goes
  straight through the model runtime, so `shapeModelRequests` and every installed fetch wrapper
  (`anthropic-subscription`) shape it like any other.
- **Never twice.** The attempt is stored as `interrupted` before the request is sent, so a crash
  mid-request counts as a failure; a failure blocks further pings until the conversation's next real
  request, so an outage or a rate limit is never retried in a loop. The switch, the conversations the
  user stopped and the last ping are in `keep-warm.json` in the data directory
  (`{ "off": true, "stop": { "3": 1793… }, "last": { "3": { … } } }`); the user's last input and the
  last cached answer come from the commits, and a restart recovers them from the baseline views the
  loader hands over.
- **What it costs.** A ping's tokens are not in `pi.usage`: they belong to no entry, so the
  conversation's spend does not include them. The popover shows what the last ping read and wrote.
- **The chip.** `warm` in the `end` slot: an ember flame (`--role-ember`, Catppuccin's peach) while
  it is on, dim while it is off. The popover has the switch, "Warm until 14:52" or "Cold since …",
  the next ping or why none is coming, and the last ping's read and write.
- **The switch is one for every conversation.** A ping is a spend, so the popover also lists what it
  is spent on: "Also warming", one row per other conversation with a ping coming, the most recently
  asked first, with the time of that ping. Rows come from the commits and the state file — the same
  data the tick reads — so the list never promises a ping the tick will not send. A conversation
  whose cache is already cold is not listed: it is not being warmed, and a ping would only pay to
  rebuild it. Each row is named through `sessionTitle`, so it says what the sidebar says, a rename
  included; when the core has no name yet — nothing asked, nothing written — the row falls back to
  the folder the conversation works in, and to nothing else. A conversation the core can no longer
  build a request for — deleted, unknown, or with no model chosen — is forgotten on the next tick,
  so the list stops promising a ping that cannot run.

The host members it uses are the two core seams: `sessionRequest(session)` answers the
conversation's model, the messages its next request would send, and `send(messages, signal, options?)`,
one request through the same model runtime; `sessionTitle(session)` answers the name the sidebar shows,
so a row in "Also warming" never has to re-derive it in the browser.
`busy` comes from `onCommit`, not from the seams.
