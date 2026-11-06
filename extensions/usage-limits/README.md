# Usage limits

Shows the five-hour limit of the current conversation's provider as a meter in the status bar's
`end` slot (`5h ▮▮▯ 13%`, warn above 70%, danger above 90%), and every provider's windows in a
popover.

## Usage

- The meter follows `session.model` (`provider/modelId`), so a new session or a model change shows
  the new provider's window. For `kiro-acp` models it shows the credits bucket, labelled `Cred.`.
- A click opens a popover above the button with every provider's windows and reset times. The
  current provider is highlighted.
- **Which providers.** The row in the Extensions dialog expands (`details.tsx`) to one switch per
  provider. A hidden provider is not asked at all and is not in the popover; if it is the current
  one, the status bar shows only the gauge icon. Changes apply at once.

## Configuration

`usage-limits.json` in the data directory: `{ "hidden": ["codex"] }`. A missing or broken file shows
all providers.

## Behavior

- Providers: Anthropic (OAuth only), OpenCode Go, OpenAI Codex and Kiro. A failing provider is an
  error row, never a crash.
- Anthropic and OpenCode Go tokens come from `host.resolveModelAuth` and are used only in the
  server's provider requests, never returned to the browser.
- Pi's OpenAI token is refused by the ChatGPT usage endpoint (HTTP 401), so Codex reads the Codex
  CLI's own sign-in from `$CODEX_HOME/auth.json` (`~/.codex/auth.json`). Without it Codex is absent.
- Kiro's plan credits are not on the ACP wire, so `readKiro` parses
  `kiro-cli chat --no-interactive /usage`. Without `kiro-cli` the provider is absent. It does not import `extensions/kiro-acp`.
- **Refresh.** The browser reads every five minutes and when the popover opens (the refresh button
  does the same). A session switch only picks another row of the data already loaded. The server
  caches for four minutes and skips a forced read when the last one is under 30 s old. A provider
  that answers 429 is left alone for five minutes and keeps its last reading.

## Limits

The usage endpoints are undocumented; the Kiro reader depends on a CLI output format, so a change
there shows as an error row.
