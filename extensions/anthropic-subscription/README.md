# Anthropic subscription

Adds the Claude Code billing system block to native Anthropic OAuth payloads, following Pi Pocket's
`anthropic-subscription` feature and the billing recipe in `@gotgenes/pi-anthropic-auth` (MIT, see
`LICENSE.pi-anthropic-auth`). API-key payloads and other providers are left unchanged. Existing
billing blocks are not duplicated; messages, tools and cache controls stay intact.

## Usage

It is enabled by default. Turn **Anthropic subscription** off in the Extensions dialog to send Pi's
original payloads. The open details refresh every three seconds (no polling while disabled or
collapsed) and show:

- the selected billing version and its source, and the **Sent billing version** parsed from the
  outgoing billing block (unavailable when absent or unparseable);
- the last Anthropic `POST messages` request across all sessions, published as one snapshot (a late
  response or retry cannot replace a more recently started request's snapshot);
- the learned minimum version and whether the last OAuth request's retry recovered;
- **Check subscription**, which queries Anthropic's undocumented `/api/oauth/profile` endpoint only
  when clicked and shows the subscription type and status, seat and rate-limit tiers, and whether
  extra usage is enabled. Missing fields show Unknown. Email and organization name are left out
  unless **Include email and organization** is checked; unchecking clears the profile.

The diagnostics are in memory, reset on reload or disable, and keep no message text, system prompt
or token.

## Configuration

`PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION=X.Y.Z`, set before starting the server, overrides the version
(default `2.1.280`). An override is absolute, even when lower. A malformed value fails the extension
load instead of silently sending a bad identity.

## Behavior

- **OAuth detection.** The extension checks the actual outgoing Bearer OAuth token on POST messages
  requests, not a system-prompt identity marker. API keys and other providers pass through, even if
  their prompts contain a Claude Code identity.
- **Version selection.** For OAuth requests the version is the numeric maximum of the bundled
  version, the learned minimum and the final `claude-cli/X.Y.Z` token of the HTTP User-Agent. Partial
  names and versions with extra components or suffixes do not match. The User-Agent itself is not
  rewritten. No package registry or local Claude installation is queried.
- **Rejection hints.** Only a structured HTTP 400 whose `error.details.error_code` is
  `claude_code_version_too_old` counts as a version rejection. The required floor and a recovery hint
  appear in the details and are appended to the original SDK error message; the error code, status
  and request ID stay intact. Unknown wording gives a hint without inventing a floor. If the sent
  version already meets the floor, the hint recommends updating Pi. Successful streams, other HTTP
  errors and non-JSON responses are not consumed or rewritten.
- **Recovery.** A rejection with a higher, named floor replays the request once with a rebuilt
  billing block. Never retried: existing blocks, unknown floors, explicit overrides, aborted
  requests, network failures and other HTTP errors. The caller's transport and signal serve both
  attempts. The learned minimum is shared across this extension's requests in memory. A second
  rejection is surfaced with a hint, never chased.
- **Account lookup.** The lookup times out after five seconds, disallows redirects and returns
  sanitized failures. API-key or missing authorization causes no profile request. Nothing is
  persisted and no model call is made.

## Limits

- It does not launch Claude Code, rewrite project prompts, suppress warnings, or guarantee that
  Anthropic classifies the request as subscription use.
- An applied billing shape does not prove a successful response or subscription billing. The
  profile lookup does not report remaining quota or the pool a request was billed against.
- The displayed version is not the transport's HTTP User-Agent.
