# Usage limits

`extensions/usage-limits` shows the five-hour limit of the current conversation's provider as a
meter in the `end` slot of the status bar (`5h ▮▮▯ 13%`, warn above 70%, danger above 90%). It
follows `session.model` (`provider/modelId`, in `StatusProps`), so a new session or a model change
shows the new provider's window. A click opens a popover above the button with every provider's
windows and reset times; the current provider is highlighted.

- Providers: Anthropic (OAuth only), OpenCode Go, OpenAI Codex, and Kiro. These are undocumented
  endpoints; a failing provider is an error row, never a crash.
- Anthropic and OpenCode Go tokens come from `host.resolveModelAuth` and never leave the server.
- Pi's OpenAI token is refused by the ChatGPT usage endpoint (HTTP 401), so Codex reads the Codex
  CLI's own sign-in from `$CODEX_HOME/auth.json` (`~/.codex/auth.json`). Without it Codex is absent.
- The browser reads every five minutes and when the popover opens (the refresh button does the same).
  A session switch only picks another row of the data already loaded. The server caches for four
  minutes and skips a forced read when the last one is under 30 s old. A provider that answers 429 is
  left alone for five minutes and keeps its last reading.
- Kiro's plan credits are not on the ACP wire, so `readKiro` parses `kiro-cli chat --no-interactive
  /usage` (a CLI format, not an API). Without `kiro-cli` the provider is absent. The credits bucket
  is the status bar's meter for `kiro-acp` models, labelled `Credits` instead of `5h`. It does not
  import `extensions/kiro-acp`.
- **Which providers.** The row in the Extensions dialog expands (`details.tsx`) to one switch per
  provider. The choice is stored in `usage-limits.json` in the data directory
  (`{ "hidden": ["codex"] }`; a missing or broken file shows all). A hidden provider is not asked at
  all and is not in the popover; if it is the current one, the status bar shows only the gauge icon.
  Changes apply at once.
