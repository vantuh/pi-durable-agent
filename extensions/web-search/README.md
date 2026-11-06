# Web search

Gives Pi `web_search`, using a model with a built-in search tool on a subscription you are already
signed in to. There is no search API and no key of its own.

## Usage

The tool takes `query` or `queries` (up to five, folded into one prompt, not one call each) and
optional `urls` to read alongside. It returns the model's answer, `## Sources` when available (at
most 20), and a `Searched with` line. The names `web_search` and `queries` match the `pi-web-access`
package the Pi CLI uses, so one subagent profile works with both.

## Configuration

`PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` overrides the Claude Code version for this extension and for
`anthropic-subscription`, and turns off the version learning described below.

## Behavior

Providers are tried in order: ChatGPT, Claude, Kiro. A provider without a login, or whose call fails
or times out, hands over to the next; the final error lists each reason. A stop ends the chain at
once.

- **ChatGPT.** Pi's `openai` "Sign in with ChatGPT" token, sent to `api.openai.com/v1/responses` with
  the `web_search` tool on `gpt-6-luna`. An `sk-…` API key is skipped, not used as a paid fallback.
- **Claude.** The `sk-ant-oat…` subscription token, sent to `/v1/messages` with the
  `web_search_20260209` server tool on `claude-haiku-5-5`. The call does not go through Pi's model
  transport, so it repeats the billing block of `anthropic-subscription` itself (an extension may
  not import another), and its version recovery: a 400 `claude_code_version_too_old` is replayed
  once with the version it names, which later searches start from until the server restarts.
- **Kiro.** `kiro-cli chat --no-interactive --output-format=stream-json` in an empty temporary
  folder, trusting only Kiro's own `web_search` and `web_fetch`. The process group is killed on
  stop, timeout or output past 4 MiB, so `kiro-cli-chat` does not outlive the call.
- Timeouts: 60 s per HTTP provider, 90 s for Kiro. Errors carry a status and at most 200 characters
  of body, never headers or tokens.

## Limits

The extension does not verify which billing pool a provider uses.
