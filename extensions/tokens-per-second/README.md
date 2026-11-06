# Tokens per second

`extensions/tokens-per-second` shows, under the composer, the output speed of the last answer:
`42 tok/s`.

- **How it is computed.** Output tokens of the newest assistant answer divided by its `durationMs`,
  the time from the request's start to its last token. Under 10 tok/s it shows one decimal; the title
  of the chip always does.
- **The wait for the first token is included.** The answer record does not separate it, so a slow
  start lowers the number. For that reason an answer shorter than 250 ms or with fewer than 20
  output tokens shows nothing: it would measure the wait, not a speed.
- **Only the newest answer counts.** If the newest answer is too short, the chip is absent; it does
  not fall back to an older one.
- **No hook, no tool, no storage.** It reads fields every committed answer already carries.
- **Configuration.** None. Turn it off with its switch in the Extensions dialog.
