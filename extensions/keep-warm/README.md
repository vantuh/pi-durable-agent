# Keep warm

Renews the conversation's prompt cache while you are away, so the next message can reuse its cached
prefix instead of writing it again. A ping does not guarantee a cache hit on the next request.

## Usage

A `warm` chip in the status bar's `end` slot: an ember flame (`--role-ember`) while on, dim while
off. Its popover has:

- the switch, which is one for every conversation;
- "Warm until 14:52" or "Cold since …", the next ping or why none is coming, and what the last ping
  read and wrote;
- a "Warming" list of the conversations that would be pinged, the current one included, most
  recently asked first, with the estimated ping time and a stop button per row. Stop suppresses that
  conversation's pings until a newer input.

Each row is named through `sessionTitle`, so it says what the sidebar says; with no name yet it falls
back to the conversation's folder, or "conversation" when it has none. A conversation whose cache is
already cold is not listed. The list is a candidate list, not a guarantee: a busy session or one
whose provider or model changed can stay listed though the tick will skip it. A conversation the
core can no longer build a request for (deleted, unknown, no model chosen) is forgotten when an
eligible tick next asks for its request.

## Configuration

`keep-warm.json` in the data directory holds the switch, the conversations you stopped and the last
ping: `{ "off": true, "stop": { "3": 1793… }, "last": { "3": { … } } }`.

## Behavior

- **Why an hour.** Anthropic writes the prompt cache with `cache_control.ttl: "1h"` only when the
  request asks for it. The core opens the harness with `stream: { cacheRetention: "long" }`, and
  out-of-transcript session requests default to it too (callers such as automatic naming can opt
  out). Without long retention the cache dies after five minutes and the 55-minute ping is too late.
  A cache read costs 0.1× the input price and renews the hour; a write costs 1.25× (five minutes) or
  2× (an hour).
- **When it pings.** A timer outside the task scheduler looks once a minute. A ping is due when the
  conversation's own last cache request is 55 to 60 minutes old, it has no run, it is on
  `anthropic`, and your latest input to it is under 8 hours old. A cache already past its hour is
  cold, and a ping would only pay to rebuild it.
- **What it sends.** The conversation's next context exactly as the harness would send it, plus one
  user line asking for `ok`. Nothing is written to the transcript and nothing is queued. The request
  goes straight through the model runtime, so `shapeModelRequests` and every installed fetch wrapper
  (`anthropic-subscription`) shape it like any other.
- **Never twice.** The attempt is stored as `interrupted` before the request is sent, so a crash
  mid-request counts as a failure. A failure blocks further pings until the conversation's next real
  request that renews its cache, so an outage or a rate limit is never retried in a loop. The
  user's last input and the last cached answer come from the commits; a restart recovers them from
  the baseline views the loader hands over.
- **Cost.** A ping's tokens are not in `pi.usage`, so the conversation's spend does not include them.
- **Host seams.** `sessionRequest(session)` gives the conversation's model and next messages,
  `send(messages, signal, options?)` makes one request through the same model runtime, and
  `sessionTitle(session)` gives the sidebar's name. `busy` comes from `onCommit`.

A paused session reads as busy, so keep-warm starts no pings for it.

Ported from Ultimate's `extensions/keep-warm` (MIT, see `LICENSE.ultimate`).
