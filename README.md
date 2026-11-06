# pi-durable-agent

A local coding agent with a web interface, built on `@earendil-works/pi-durable`. One person, one
process, bound to `127.0.0.1`. It uses Pi's tools and Pi's system prompt, and a UI that stays
readable on a phone.

The core is small: the event stream, the agent harness, the extension loader, and the shell
(sidebar, transcript, composer). Every other feature is a folder in `extensions/` that can be
added or deleted without touching the core.

## Requirements

- Node 26 or newer (`engines` in `package.json`). The server runs `.ts` files directly.
- pnpm.
- A Pi login. The server reads Pi's own logins and models from `~/.pi/agent` through
  `ModelRuntime`, so log in with Pi first.

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the server on `127.0.0.1:8788` and Vite with hot reload on `localhost:5190`; open
the Vite address. Vite proxies `/api` to the server. State is kept in `data/` (git-ignored), in a
SQLite file. `MODEL` (`provider/modelId`) and `PORT` change the default model and the server port.

`pnpm start` builds the shell and serves it from the server alone on port 8788. Running it on a
phone: [docs/running.md](docs/running.md).

## Scripts

| Script               | What it does                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`           | Server and Vite with hot reload.                                                |
| `pnpm dev:web`       | Vite alone; options after it go to Vite.                                        |
| `pnpm dev:server`    | The server alone, supervised so the Restart button works.                       |
| `pnpm start`         | Build, then serve `dist/` from the server.                                      |
| `pnpm build`         | Build the browser bundle into `dist/`.                                          |
| `pnpm test`          | `node --test` on `test/` and `extensions/`.                                     |
| `pnpm check`         | Format check, type-aware lint, type check. Fails on warnings.                   |
| `pnpm fix`           | Format and apply lint fixes.                                                    |
| `pnpm preview:phone` | Build and serve `dist/` on the local network, port 5192, to open it on a phone. |

## How it is built

| Folder        | Holds                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `server/`     | HTTP and SSE routes, the harness, the extension loader. Runs as `.ts`. |
| `shared/`     | `protocol.ts`, the one contract the browser sees.                      |
| `web/`        | The React shell: sidebar, transcript, composer.                        |
| `extensions/` | One folder per feature: tools, prompt sections, hooks, UI.             |
| `test/`       | Core tests. Extensions keep theirs beside `server.ts`.                 |

The core knows no extension by name. The server half of an extension reloads on save; a change
to `server/` needs the restart button in Settings. The contract and the folder layout are in
[docs/extensions.md](docs/extensions.md). Rules for working on the code, including those for
agents, are in [AGENTS.md](AGENTS.md).

## Extensions

Each has a `README.md` in its folder.

**Tools for the model**

- [`web-search`](extensions/web-search/README.md): the `web_search` tool.
- [`web-fetch`](extensions/web-fetch/README.md): the `fetch_content` tool, a page as Markdown.
- [`browser`](extensions/browser/README.md): a real Chromium the model drives, shown in a panel.
- [`codemode`](extensions/codemode/README.md): the model scripts its tools in a QuickJS sandbox.
- [`subagents`](extensions/subagents/README.md): hand a task to another durable agent.
- [`mcp`](extensions/mcp/README.md): servers from Pi's `mcp.json`.

**Prompt and voice**

- [`prompt`](extensions/prompt/README.md): the rules the agent is told, as system prompt sections.
- [`caveman`](extensions/caveman/README.md), [`ponytail`](extensions/ponytail/README.md): optional answer styles, off by default.

**Providers and requests**

- [`anthropic-subscription`](extensions/anthropic-subscription/README.md): Claude Code billing block for Anthropic OAuth.
- [`kiro-acp`](extensions/kiro-acp/README.md): the local `kiro-cli` models as a provider.
- [`image-limit`](extensions/image-limit/README.md): shrinks images a provider would refuse.
- [`keep-warm`](extensions/keep-warm/README.md): renews the prompt cache while you are away.

**Running conversations**

- [`bash-timeout`](extensions/bash-timeout/README.md): idle and total timers on every `bash` call.
- [`bash-view`](extensions/bash-view/README.md): a `bash` call's command laid out one statement and chain part per line.
- [`pause`](extensions/pause/README.md): hold a run at its next step instead of stopping it.
- [`finished`](extensions/finished/README.md): tells you in the browser that a run has ended.
- [`push`](extensions/push/README.md): Web Push when Pi finishes an answer.

**Status bar and composer**

- [`cache-hit`](extensions/cache-hit/README.md), [`context-meter`](extensions/context-meter/README.md), [`tokens-per-second`](extensions/tokens-per-second/README.md), [`usage-limits`](extensions/usage-limits/README.md): meters for cache, context window, output speed and provider limits.
- [`dictation`](extensions/dictation/README.md): a mic in the composer.
- [`hotkeys`](extensions/hotkeys/README.md): shortcuts bound to physical keys.

**Panels and pages**

- [`files`](extensions/files/README.md): read-only file viewer for the session's folder.
- [`terminal`](extensions/terminal/README.md): a shell in the session's folder.
- [`notes`](extensions/notes/README.md): a scratchpad and to-do list per repository.
- [`git-branch`](extensions/git-branch/README.md): shows and switches the branch.
- [`git-history`](extensions/git-history/README.md): commit list and embedded review.
- [`git-worktree`](extensions/git-worktree/README.md): worktrees in the folder picker.

**Session list**

- [`auto-session-name`](extensions/auto-session-name/README.md): names a session from what it was about.
- [`tags`](extensions/tags/README.md): your own tags on sessions.

## Documentation

[docs/README.md](docs/README.md) is the index.

- [docs/stack.md](docs/stack.md): what it is built with, and why.
- [docs/conventions.md](docs/conventions.md): every rule, and the mistake it prevents.
- [docs/server.md](docs/server.md): the HTTP and SSE API, and how a conversation runs.
- [docs/sessions.md](docs/sessions.md): the session list, live state, seen, archive, delete.
- [docs/extensions.md](docs/extensions.md): the extension contract and the host.
- [docs/layout.md](docs/layout.md): the shell.
- [docs/theme.md](docs/theme.md): the Catppuccin theme and its roles.
- [docs/pwa.md](docs/pwa.md): manifest, icons, and the offline shell worker.
- [docs/running.md](docs/running.md): running it, and the production build on a phone.

## License

The repository has no `LICENSE` file, so no license is granted here. Code ported from other
projects keeps its notice in a `LICENSE.*` file beside it (for example in `extensions/git-history`).
