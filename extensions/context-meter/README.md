# Context meter

`extensions/context-meter` draws `context` under the composer: how full the model's context window is,
and, on a click, what the context holds — the system prompt sections and the tools, each with its size.

- **Before the first request it is an estimate.** A session with nothing in it has no answer to price,
  so the meter shows what that first request will carry — every section the extensions render and the
  tool declarations the agent offers — sized at 3.5 characters per token. The number is prefixed with
  `≈` and the popover says so. Nothing is sent, nothing is written to the transcript, and edits to the
  prompt, the model or the folder show up when the popover is opened again.
- **After that it is the last answer the provider priced.** `input + output + cacheRead + cacheWrite`
  over the model's context window: the prompt the request read, plus what the answer added, which is
  what the next request starts from. A failed request, or one stopped before its stream started,
  carries only zeros, and the meter keeps showing the last answer that was priced.
- **Row sizes are calibrated when the first answer can be compared.** On the first counted answer the
  prompt's real token count is divided by what the same prompt estimates to; every row is scaled by
  that ratio for the session. The rows cover system sections and tools, not user messages or output,
  so their sum is not the whole context. The ratio is undefined — rows stay raw estimates — when
  anything but system sections and text preceded the answer, such as an image or a tool result.
- **Tools arrive as they were committed.** The rows replay the `pi.system` entries in order, sections
  set and removed, tools added and removed, so a tool a `bash`-like call added mid-conversation is
  there and one removed is not. Two or more tools from the same extension fold into one row named
  after the folder, holding them; a lone tool keeps a row of its own.
- **Rows are shares of the biggest row, not of the window.** The bar beside each row is relative to
  the largest part, so a 300-token tool stays visible next to a 40,000-token prompt. The header's bar
  and percent show the window's fill, estimated before the first request: yellow above 70%, red above 90%.
- **Nothing is shown when there is nothing honest to show:** a session with a question but no answer
  yet, one whose model the catalog does not know, or one the server cannot build a prompt for. The
  popover's first row always names the model the figure belongs to.
- **The preview is not a provider payload.** It excludes the composer's draft, attachments, and blocks
  added by provider serialization or fetch wrappers. Prompt sections can change before sending.

It reads `host.sessionPrompt(session)` for the pre-request prompt — the core seam beside
`sessionRequest`, which renders the sections and tool declarations an empty session's first request
will carry, without writing an entry or calling a model, and answers nothing once the session has
entries — and `host.contextWindow`, `host.toolOwner` and `onCommit` for everything else.
