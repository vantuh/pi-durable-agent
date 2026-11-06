# Cache hit

Shows under the composer how much of the input came from the provider's prompt cache: `cache 83%`.

## Usage

The chip sits in the composer status row. Its title states the same figure in words. It has no
tool, hook or setting; turn it off with its switch in the Extensions dialog.

## Behavior

- Over the assistant answers in the entries the view holds (the newest 50 to 100), it divides cache
  reads by everything the requests sent: fresh input, cache reads and cache writes.
- It reads usage the harness already records on every answer, so it adds nothing to the prompt or
  the requests.
- With no answer in the window, or no input in it, the chip is absent.

## Limits

- The number is the window's, not the conversation's. Older answers that scrolled out of the window
  do not count.
- A provider that does not report cache usage always shows `0%`.
