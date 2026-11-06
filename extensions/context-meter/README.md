# Context meter

Draws `context` under the composer: how full the model's context window is. A click shows what the
context holds: the system prompt sections and the tools, each with its size.

## Usage

- The header's bar and percent show the window's fill: yellow above 70%, red above 90%.
- The popover's first row names the model the figure belongs to. Each row has a bar relative to the
  largest row, not to the window, so a 300-token tool stays visible next to a 40,000-token prompt.
- Two or more tools from the same extension fold into one row named after the folder; a lone tool
  keeps its own row.
- Nothing is shown when there is nothing honest to show: a session with a question but no answer
  yet, one whose model the catalog does not know, or one the server cannot build a prompt for.

## Behavior

- **Before the first request it is an estimate.** The meter shows what that first request will
  carry (every section the extensions render, and the tool declarations the agent offers) at 3.5
  characters per token. The number is prefixed with `≈` and the popover says so. Nothing is sent or
  written to the transcript, and edits to the prompt, model or folder show up when the popover is
  opened again.
- **After that it is the last answer the provider priced:** `input + output + cacheRead +
  cacheWrite` over the model's context window. A failed request, or one stopped before its stream
  started, carries only zeros; the meter keeps the last priced answer.
- **Row sizes are calibrated** on the first counted answer: the prompt's real token count divided by
  what the same prompt estimates to scales every row for the session. The rows cover system sections
  and tools, not user messages or output, so their sum is not the whole context. When anything but
  system sections and text preceded the answer (an image, a tool result), the ratio is undefined and
  rows stay raw estimates.
- **Tools arrive as committed.** The rows replay the `pi.system` entries in order (sections set and
  removed, tools added and removed), so a tool added mid-conversation is there and a removed one is
  not.
- It uses `host.sessionPrompt(session)` for the pre-request prompt (it answers nothing once the
  session has entries), `host.sessionContext(session)` for the entries the next request is built from
  (a commit's `entries` is only the view's window of 50 to 100 and leaves out the system entries and
  the first answer), plus `host.contextWindow` and `host.toolOwner`.

## Limits

The preview is not a provider payload. It excludes the composer's draft, attachments, and blocks
added by provider serialization or fetch wrappers. Prompt sections can change before sending.
