# MCP servers

Connects to the servers in Pi's own `mcp.json` with `@earendil-works/pi-mcp` and gives Pi one tool,
`mcp`, to use them.

## Usage

- The Extensions dialog lists the servers (`details.tsx`), each with a switch.
- The `mcp` tool: no arguments lists connected servers; `server` shows its tools with their input
  schemas; `server` + `tool` + `arguments` calls one. A server's tools are not registered one by one,
  because there can be dozens and an extension's tool set is fixed when it is installed.
- The list shows a stdio server's `command` only, never its arguments, environment or headers.

## Configuration

- `<agent dir>/mcp.json` (so profiles work). A server is `command` + `args` + `env` (stdio) or
  `url` + `headers` (Streamable HTTP). An `env` or `headers` value starting with `!` is a shell
  command whose output is the value, as in Pi's other files.
- Servers are on unless `enabled: false` is set; a saved switch overrides that default. The switch is
  stored in `enabled.json` under `mcp/` in the data directory. `mcp.json` is never written, because
  Pi's CLI reads it too.

## Behavior

- Servers that are on connect in the background when the extension installs; a failure shows as the
  server's status. Turning the extension off, reloading it or stopping the server closes them.
- The details view re-reads `mcp.json`, but existing connections do not adopt edits. Turn a server
  off and on, or reload the extension, to connect with the updated configuration.

## Limits

Not supported: OAuth (`mcp-auth.json`), a project's own `.pi/mcp.json`, automatic reconfiguration of
live connections, `exposure`, resources and prompts.
