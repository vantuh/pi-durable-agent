# Keep warm

`extensions/keep-warm` aims to renew the conversation's prompt cache while you are away, so the
next message can reuse its cached prefix instead of writing it again. A ping does not guarantee a
cache hit on the next request. Ported from Ultimate's `extensions/keep-warm`, with the harness seam
below instead of theirs.

- **Why an hour.** Anthropic writes the prompt cache with `cache_control.ttl: "1h"` only when the
  request asks for it. The core opens the harness with `stream: { cacheRetention: "long" }`, and
  out-of-transcript session requests default to it too; callers such as automatic naming can opt
  out. Without long retention the cache dies after five minutes and the 55-minute ping is too late.
  A cache read costs 0.1× the input price and renews the hour, a write costs 1.25× (five minutes) or
  2× (an hour), and only the new suffix is written.
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
  request that renews its cache, so an outage or a rate limit is never retried in a loop. The switch,
  the conversations the user stopped and the last ping are in `keep-warm.json` in the data directory
  (`{ "off": true, "stop": { "3": 1793… }, "last": { "3": { … } } }`); the user's last input and the
  last cached answer come from the commits, and a restart recovers them from the baseline views the
  loader hands over.
- **What it costs.** A ping's tokens are not in `pi.usage`: they belong to no entry, so the
  conversation's spend does not include them. The popover shows what the last ping read and wrote.
- **The chip.** `warm` in the `end` slot: an ember flame (`--role-ember`, Catppuccin's peach) while
  it is on, dim while it is off. The popover has the switch, "Warm until 14:52" or "Cold since …",
  the next ping or why none is coming, and the last ping's read and write.
- **The switch is one for every conversation.** A ping is a spend, so the popover also lists what it
  is spent on: "Warming", including the current conversation, most recently asked first, with the
  estimated ping time. Rows come from the commits and the state file, not fresh model requests.
  A busy session or one whose provider/model changed can remain listed even though the tick will
  skip it; this is a candidate list, not a guarantee that a ping will run. A conversation
  whose cache is already cold is not listed: it is not being warmed, and a ping would only pay to
  rebuild it. Each row is named through `sessionTitle`, so it says what the sidebar says, a rename
  included; when the core has no name yet — nothing asked, nothing written — the row falls back to
  the folder the conversation works in, or "conversation" when it has no folder. Each row has a stop
  button that suppresses its pings until a newer input. A conversation the core can no longer build
  a request for — deleted, unknown, or with no model chosen — is forgotten when an eligible tick
  next asks for its request; the age and busy checks can postpone that lookup.

The host members it uses are the two core seams: `sessionRequest(session)` answers the
conversation's model, the messages its next request would send, and `send(messages, signal, options?)`,
one request through the same model runtime; `sessionTitle(session)` answers the name the sidebar shows,
so a row in "Warming" never has to re-derive it in the browser.
`busy` comes from `onCommit`, not from the seams.
