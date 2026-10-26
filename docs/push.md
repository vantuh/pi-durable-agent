# Push notifications

`extensions/push` sends a Web Push notification to your devices when Pi finishes an answer.
Everything is in that folder; the core only gives it `host.onCommit`, the `?session=ID` link and the
worker facet ([extensions.md](extensions.md)).

## When it sends

- A turn counts as finished when the final answer ends with `stopReason: "stop"` and the run is
  idle. A queued message that starts while the run is busy also ends the turn before it.
- Errors, aborts, tool-only rounds and answers cut off by length send nothing.
- Each conversation has a settled point: the last entry whose turn is accounted for. It is kept in
  `push.json` as one number per conversation (never content), once a device is subscribed. Each
  commit is judged inside the serialised change to that file, from the saved point, which wins over
  the memory of any version. So a snapshot that arrives again, or after a restart or a reload,
  sends a turn that ended in the gap, and two overlapping versions never both send it.
- With no device subscribed, only an in-memory baseline moves; nothing is written.
- A conversation with no settled point only sets a baseline, so old history never sends.
- A version that is turned off before it saves claims nothing, and the next version sends the turn.
  Once a version has saved, its send finishes even if it is turned off at that moment.
- The extension relies on the core giving a new listener the current state of each conversation
  before later commits (a snapshot at start and after a reload).
- The text is always "Pi finished" with a generic line. It has no answer or reasoning. The link is
  `/?session=ID`.

## Setup

Open Settings, then Notifications. Enter a contact and press "Enable on this device".

- The contact is the VAPID subject that push services use to reach you: an email address or an
  HTTPS address on a public name (this is only the contact; the app itself can run on `localhost` or
  behind a trusted private HTTPS tunnel). It is prefilled with the app's address only when that is
  public HTTPS. Blank, `localhost`, IP addresses and `http` are refused.
- The permission prompt comes from that button, never on load.
- The VAPID keys are made the first time you press it, after the browser allowed notifications.
- "Disable on this device" removes this device only.
- The section explains why it is blocked: not a secure context (HTTPS or `localhost`), no push support (on iPhone the app must be on
  the Home Screen), the development server (no worker), or notifications denied.

## Data and checks

`push.json` in the data directory holds the keys, the contact and the subscriptions. It is written
atomically with mode `0600`, changes run one at a time, and a file that cannot be read is never
replaced. The keys and subscriptions are never logged.

A subscription is accepted only for `https` endpoints on the push services of Chrome (FCM), Firefox,
Edge (Windows) and Safari (Apple), with no port, credentials or fragment, and with a 65-byte
uncompressed P-256 `p256dh` and a 16-byte `auth`. A device that answers 404 or 410 is removed; other
failures keep it. A send waits 10 seconds at most. Encryption and signing come from `web-push`.

Turning the extension off, or deleting it, removes its listener and stops new claims. An already
claimed notification can still finish sending.

## Limits

No badges, approvals from the notification, test button, per-event preferences or background sync.
A secure context is enough to use the app: `localhost`, or a trusted HTTPS address such as a private
authenticated tunnel. Public HTTPS is not required. The API has no authentication: do not expose it
to the public internet without access control.

Delivery is at-most-once. A process crash after saving the completion claim but before sending can
lose a notification. Transient send failures are not retried, although the subscription stays saved.

A synthetic push through Chromium's DevTools protocol showed a notification, including with no app
page open. Delivery from a real push service to a real device is not verified.
