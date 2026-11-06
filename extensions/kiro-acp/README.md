# Kiro ACP

Adds the local `kiro-cli`'s models to the model picker as provider `kiro-acp`, through
`@vantuh/pi-kiro-acp`.

## Usage

Kiro signs in through `kiro-cli` itself, so there is no key to add. The picker's `scoped` tab uses
Pi's `enabledModels` setting when configured, and may contain `kiro-acp/<model>` entries (also added
with the picker's **Add to scoped models** button). Otherwise it lists the models the runtime
considers authenticated. The `all` tab lists the whole catalog; so does `scoped` when its result is
empty.

## Configuration

The package is an optional dependency, `file:../../../pi-kiro-acp` in the extension's manifest: a
checkout beside this one, installed _injected_ so it shares this app's `@earendil-works/pi-ai`
instead of loading a second copy. Build it once there with `npm run build`; that writes the `dist/`
the `./provider` subpath points at. A Git worktree needs the built sibling beside the worktree
being installed, not only beside the primary checkout. A successful frozen install does not prove
the provider is available; its import must succeed too.

## Behavior

- Pi keeps the conversation and the tools. Kiro sees the session's tools over an in-process MCP
  server, and its own built-ins are refused at the permission gate.
- `provider.close()` stops the `kiro-cli` processes it started, on reload, off, removal and
  shutdown.
