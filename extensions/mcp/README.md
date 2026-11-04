# MCP servers

`extensions/mcp` reads the servers from Pi's own `mcp.json` (`<agent dir>/mcp.json`, so profiles
work) and connects to them with `@earendil-works/pi-mcp`. The Extensions dialog lists them (`details.tsx`), each with a switch.

- A server is `command` + `args` + `env` (stdio) or `url` + `headers` (Streamable HTTP). An `env` or
  `headers` value starting with `!` is a shell command whose output is the value, as in Pi's other
  files. Servers are on unless `enabled: false` is set; a saved switch overrides that default.
- The switch is stored in `enabled.json` under the data directory's `mcp/`. `mcp.json` is never
  written: Pi's CLI reads it too.
- Servers that are on connect when the extension installs, in the background; a failure shows as
  the server's status. Turning an extension off, reloading it or stopping the server closes them.
- Pi gets one tool, `mcp`: no arguments lists connected servers, `server` shows its tools with their input
  schemas, `server` + `tool` + `arguments` calls one. A server's tools are not registered one by one:
  there can be dozens, and the tool set of an extension is fixed when it is installed.
- The list shows a stdio server's `command` only, never its arguments, environment or headers.
- The details state re-reads `mcp.json`, but existing connections do not automatically adopt edits.
  Turn a server off and on, or reload the extension, to connect with its updated configuration.
- Not built: OAuth (`mcp-auth.json`), a project's own `.pi/mcp.json`, automatic connection
  reconfiguration, `exposure`, resources and prompts.
