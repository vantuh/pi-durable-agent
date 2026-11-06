# Stack

What the app is built with, why, and what each choice costs. Versions are what `package.json` pins.

## Shape

- **One Node process** serves the browser and runs the agent. No second service, no queue.
- **One SQLite file** holds conversations, entries, and runs. `pi-durable` writes it
  (`@earendil-works/pi-durable/storage/sqlite/node`).
- **One browser bundle** built by Vite. The server is never bundled.
- **SSE plus plain `POST`s** carry state: `pi-durable` already hands out the committed view, and the
  browser never streams upward, so there is no WebSocket.

## Chosen

| Layer      | Choice                                  | Why                                                                        | Cost                                                              |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Runtime    | Node 26                                 | Runs `.ts` directly by type stripping: no build, no watcher for the server | Imports need the `.ts` extension; erasable syntax only            |
| Language   | TypeScript 7, `strict`, `noEmit`        | Vite and Node strip types; `tsc` only checks                               | Nothing is emitted, so no declaration files                       |
| UI         | React 19                                | Known; the ecosystem `shadcn` copies expect                                | A virtual DOM we do not need for a mostly-append-only transcript  |
| Build      | Vite 8, root `web/`, output `dist/`     | Fast HMR on the client, nothing on the server                              | Two module systems to keep apart                                  |
| Styles     | Tailwind 4 through `@tailwindcss/vite`  | No `tailwind.config.js`; design tokens live in CSS `@theme`                | Class strings are long; needs `sortTailwindcss`                   |
| Components | `shadcn/ui`, copied in on demand        | The code lands in the repo, so it can be edited freely                     | Radix comes as the single `radix-ui` package                      |
| Icons      | `lucide-react`                          | What `shadcn` expects                                                      | One dependency for tree-shaken icons                              |
| Toasts     | `sonner`                                | Animation, stacking, announcements and timeouts we would otherwise write   | Its own skin is switched off and replaced by the theme            |
| Markdown   | `react-markdown`, `remark-gfm`, `shiki` | Answers render as Markdown; code is highlighted                            | Shiki's languages and themes are lazy chunks                      |
| Zoom       | `react-zoom-pan-pinch` 4.2.0            | Wheel, pinch and drag in the viewer, as people expect them                 | A dependency for gestures; it injects its own stylesheet          |
| Agent      | `@earendil-works/pi-durable` 1.5.0      | Tools, durable state, model turns, subagents, tasks, extensions            | Marked experimental upstream: the API may change between releases |
| Routing    | Hono 4, `@hono/node-server` 2           | Typed routes and validators, and the browser's typed client (`hc`)         | A framework in the server; the raw paths depend on its adapter    |
| Validation | Zod 4, `@hono/zod-validator`            | One schema is a route's checked input and `hc`'s typed input               | Two dependencies; `jsonBody` reads the body itself                |
| Lint       | `oxlint`                                | Fast, no plugin zoo                                                        | Rule coverage is smaller than ESLint's                            |
| Format     | `oxfmt`                                 | 4 spaces, 100 columns, sorted imports and Tailwind classes                 | Young tool; formatting may shift between versions                 |
| Packages   | pnpm 11                                 | Matches the other repos                                                    | —                                                                 |

`@/` maps to `web/src`. The theme is Catppuccin ([theme.md](theme.md)).

## What we did not take

- **Access control**: no accounts, roles, invites, sharing, take-turns.
- **Infrastructure**: no spend limits, gallery or PR watches. Worktrees and push notifications exist as
  extensions (`git-worktree`, `push`), not in the core.
- **Front-end libraries**: no state library, no router library, no component framework, no data-fetching
  cache. The data arrives over SSE into one hand-written store; `web/src/lib/route.ts` keeps `?session=` and
  `?page=` in step with the history.
- **Server tooling**: no bundler, no nodemon. `scripts/serve.ts` starts the server again when the
  app asks (exit code 75), and that one parent is the whole watcher.
- **Server frameworks beyond the route table**: Hono routes and validates; the socket, the event
  streams, the static files and the shutdown stay `node:http`, hand-written. `streamSSE` and
  `hono/compress` would drop the gzip flush per event and the 1 MB stall cap, and `hono/compress` gzips a
  15-byte body and ignores `q` values.
- **An SSE library**: it would replace about fifty lines and none of the gzip, stall or snapshot logic.
- **A monorepo split** (`apps/web`, `apps/server`): it would cut every extension in half. Server, browser and
  extension stay in one repository, with an extension as a vertical folder.
- **Feature-Sliced Design**: it fights the extension model.

## Rules the stack imposes

1. Server files import with the `.ts` extension: `import { x } from "./db.ts"`.
2. Server files use erasable syntax only: no `enum`, no parameter properties, no `namespace`.
3. Client files never import from `server/`, except `import type { AppType }` from
   `server/app-type.ts`, which types the `hc` client. The rest of the contract is the event stream
   and `shared/`.
4. The browser learns state from the server's event stream. No polling loops.
5. The server binds `127.0.0.1`. With no sign-in, that binding **is** the security model.
6. One gate and one repair: `pnpm check` and `pnpm fix`. The strict flags and rules, and the
   mistake each one catches, are in [conventions.md](conventions.md).

## The Pi packages

- **They move together, pinned exactly.** `pi-durable`, `pi-ai`, `pi-coding-agent`, `chord`, `pi-codemode`
  and `pi-mcp` are one version in the root and in every extension's `package.json`. `pi-durable` pins
  `chord`, `pi-ai`, `pi-codemode`, `pi-schema` and `pi-telemetry` to its own version, and a second `chord`
  copy would give two `Context` implementations, so `withCancel` and `BACKGROUND_CONTEXT` could stop
  matching.
- **Schemas.** `pi-schema` arrives with `pi-durable`; a tool's schema is built with it
  ([conventions.md](conventions.md#extensions-and-tests)). `typebox` is in the tree only as
  `pi-coding-agent`'s dependency, which `ModelRuntime` needs.
- **Data goes forward only.** A new Pi version migrates older `pi.live`, `pi.tool` and `pi.generation`
  documents when it reads them, and the older version cannot read what the newer wrote. Back up
  `data/state.sqlite` (with `-wal` and `-shm`) before the first start on a new version.
- **Reads are frozen.** What `tx.task()`, `tx.conversation()`, `getTask()`, `runtime.entry()` and published
  entries return is shared with Durable's caches, and mutating it throws.
- **A conversation view is a window** of its newest entries, and a watch merges the commits made while its
  listener runs ([server.md](server.md#the-view-is-a-window)). So `host.onCommit` listeners can receive
  fewer calls than there were commits.
- **Harness-written error results** (`tool_unavailable`, `invalid_arguments`, `blocked`, `interrupted`,
  `restart_limit`, `aborted`) go through `afterTool`.
- **`pi.live.runFailure`** says why a run ended without an answer (`model_error`, `interrupted`,
  `restart_limit`, ...). Nothing reads it yet, so a run that failed that way ends idle with no failure shown in
  the transcript.
