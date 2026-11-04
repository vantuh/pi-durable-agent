# Kiro ACP models

`extensions/kiro-acp` adds the local `kiro-cli`'s models as provider `kiro-acp`, through
`@vantuh/pi-kiro-acp` from the checkout beside this one (`file:../pi-kiro-acp`). The dependency is
installed _injected_, so the package shares this app's `@earendil-works/pi-ai` instead of loading a
second copy; build it once there with `npm run build`, which is what writes the `dist/` the
`./provider` subpath points at. Pi keeps the conversation and the tools: Kiro sees the session's
tools over an in-process MCP server, and its own built-ins are refused at the permission gate.
`provider.close()` stops the `kiro-cli` processes it started, on reload, off, removal and shutdown.

Kiro signs in through `kiro-cli` itself, so there is no key to add. The model picker's `scoped` tab
lists only what `~/.pi/agent/settings.json` names in `enabledModels`; until `kiro-acp/<model>`
entries are added there, the Kiro models sit in `all`.
