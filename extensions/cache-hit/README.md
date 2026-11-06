# Cache hit

`extensions/cache-hit` shows, under the composer, how much of the input came from the provider's
prompt cache: `cache 83%`.

- **What it counts.** Over the assistant answers in the entries the view holds (the newest 50 to
  100), cache reads divided by everything the requests sent: fresh input, cache reads and cache
  writes. The title of the chip says the same in words.
- **Nothing to show.** With no answer in the window, or an answer window with no input at all, the
  chip is absent.
- **No hook, no tool, no storage.** It reads usage the harness already records on every answer, so
  it adds nothing to the prompt and nothing to the requests.
- **Configuration.** None. Turn it off with its switch in the Extensions dialog.

Limits: the number is the window's, not the conversation's. A session whose older answers have
scrolled out of the window is judged on the newer ones, and a provider that does not report cache
usage always shows `0%`.
