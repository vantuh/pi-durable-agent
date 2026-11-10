# Agent Browser

The `browser` tool of [Browser](../browser/README.md), run by
[agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel Labs) instead of our own
DevTools driver. It is here to compare the two: same tool name, same parameters, same prompt
section, a different engine underneath.

## Usage

- Turn **Browser** off and **Agent Browser** on in Settings. Both provide the `browser` tool, so the
  loader refuses whichever comes second while both are on.
- Pi uses the `browser` tool as before. You watch and use the page in the **Agent Browser** panel.

## Configuration

- None. `agent-browser` is this extension's npm dependency, pinned exactly. Its package carries the
  binary for every platform, so its install script is not run (`allowBuilds` in
  `pnpm-workspace.yaml`).

## Behavior

- Each conversation is an agent-browser session named `pda-<id>`: its own daemon and its own
  headless Chrome, started by the first command. The daemon stops after 30 minutes without a
  command, and closes when its conversation is deleted.
- Each tool call runs the CLI (`--json`) once or a few times. A call ends with the page's
  address, title and size, read with one `eval`.
- The panel connects to the session's WebSocket stream (`stream status` gives the port) while its
  tab is in front, with ack pacing: the next frame comes once the last one is drawn. Input goes
  back over the same socket.
- `snapshot` is agent-browser's compact accessibility tree (`snapshot -c`), with refs like
  `[ref=e12]`.

## Limits

- The stream accepts only pages from `localhost` or `127.0.0.1`: the panel does not work from a
  phone or over a tunnel.
- `press` with `Control+A` or `Meta+A` selects nothing: agent-browser sends the keys but not the
  editor command headless Chrome needs. `type` with a ref replaces the field's text instead.
- No console list, Stop button, or back and forward state in the panel; no console errors appended
  to each call; `mobile` and `tablet` set the size and scale but not touch emulation.
- Turning the extension off or restarting the server leaves running sessions to their idle timeout.
- Every session listens on a local DevTools port (agent-browser starts Chrome with
  `--remote-debugging-port=0`), which any local process can use. Browser uses a pipe instead.
