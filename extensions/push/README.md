# Push notifications

Sends a Web Push notification to your devices when Pi finishes an answer. Everything is in this
folder; the core only gives it `host.onCommit`, the `?session=ID` link and the worker facet
([extensions.md](../../docs/extensions.md)).

## Usage

Open Settings, then Notifications. Enter a contact and press "Enable on this device". "Disable on this
device" removes this device only.

- The contact is the VAPID subject that push services use to reach you: an email address or an HTTPS
  address on a public name. It is only the contact; the app itself can run on `localhost` or behind a
  trusted private HTTPS tunnel. It is prefilled with the app's address only when that is public
  HTTPS. Blank, `localhost`, IP addresses and `http` are refused.
- The permission prompt comes from that button, never on load. The VAPID keys are made the first
  time you press it, after the browser allowed notifications.
- The section explains why it is blocked: not a secure context (HTTPS or `localhost`), no push
  support (on iPhone the app must be on the Home Screen), the development server (no worker), or
  notifications denied.
- The title is the conversation's title ("Pi finished" while it has none) and the body is
  "Finished · <folder>". It has no answer or reasoning. The link is `/?session=ID`. The payload is
  encrypted for the device, but the lock screen shows the title.

## Configuration

`push.json` in the data directory holds the keys, the contact and the subscriptions, plus one number
per conversation (its settled point, never content). It is written atomically with mode `0600`,
changes run one at a time, and a file that cannot be read is never replaced. Keys and subscriptions
are never logged.

## Behavior

**When it sends**

- A turn counts as finished when the final answer ends with `stopReason: "stop"` and the run is idle.
  A queued message that starts while the run is busy also ends the turn before it. Errors, aborts,
  tool-only rounds and answers cut off by length send nothing.
- A finished turn waits 5 seconds, then sends only if nobody saw it end and the session is not
  working again. A browser that shows the session, visible and focused, marks it seen
  (`host.sessionSeen`), so working at the computer keeps the phone quiet. A session still counts as
  working while a subagent it started (at any depth) runs, or while that subagent's report is starting
  its next turn (`host.sessionWorking`).
- A session started by another session (a subagent) never sends; its owner reports the job.
- **Settled point.** Each conversation has one: the last entry whose turn is accounted for, kept once
  a device is subscribed. Each commit is judged inside the serialised change to `push.json`, from the
  saved point, which wins over any version's memory. A snapshot that arrives again, or after a restart
  or reload, sends a turn that ended in the gap, and two overlapping versions never both send it.
- With no device subscribed, only an in-memory baseline moves. A conversation with no settled point
  only sets a baseline, so old history never sends.
- A version turned off before it saves claims nothing, and the next version sends the turn. Once a
  version has saved, its send finishes even if it is turned off at that moment.
- The extension relies on the core giving a new listener the current state of each conversation
  before later commits (a snapshot at start and after a reload).

**Subscriptions**

- Accepted only for `https` endpoints on the push services of Chrome (FCM), Firefox, Edge (Windows)
  and Safari (Apple), with no port, credentials or fragment, a 65-byte uncompressed P-256 `p256dh` and
  a 16-byte `auth`.
- A device that answers 404 or 410 is removed; other failures keep it. A send waits 10 seconds at
  most. Encryption and signing come from `web-push`.
- Turning the extension off, or deleting it, removes its listener and stops new claims. An already
  claimed notification can still finish sending.

## Limits

- No badges, approvals from the notification, test button, per-event preferences or background sync.
- Delivery is at-most-once. A crash after saving the completion claim but before sending can lose a
  notification. Transient send failures are not retried, though the subscription stays saved.
- The API has no authentication: do not expose it to the public internet without access control.
- Delivery from a real push service to a real device is not verified; a synthetic push through
  Chromium's DevTools protocol showed a notification, including with no app page open.
