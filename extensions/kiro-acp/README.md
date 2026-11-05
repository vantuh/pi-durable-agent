# Kiro ACP models

`extensions/kiro-acp` adds the local `kiro-cli`'s models as provider `kiro-acp`, through
`@vantuh/pi-kiro-acp` from the checkout beside this one
(`file:../../../pi-kiro-acp` in the extension's manifest). The dependency is
installed _injected_, so the package shares this app's `@earendil-works/pi-ai` instead of loading a
second copy; build it once there with `npm run build`, which is what writes the `dist/` the
`./provider` subpath points at. A Git worktree needs that built sibling beside the worktree being
installed, not just beside the primary checkout. A successful frozen install alone does not prove
that this optional local provider is available; its import must succeed too.

Pi keeps the conversation and the tools: Kiro sees the session's
tools over an in-process MCP server, and its own built-ins are refused at the permission gate.
`provider.close()` stops the `kiro-cli` processes it started, on reload, off, removal and shutdown.

Kiro signs in through `kiro-cli` itself, so there is no key to add. The model picker's `scoped` tab
uses Pi's `enabledModels` setting when configured; otherwise it lists the models the runtime
considers authenticated. A configured list can include `kiro-acp/<model>` entries, also added with
the picker's **Add to scoped models** button. The `all` tab lists the whole catalog. If the scoped
result is empty, even the `scoped` tab falls back to that catalog, including Kiro.
