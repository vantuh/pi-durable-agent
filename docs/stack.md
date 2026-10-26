# Stack

The first choice, recorded so later decisions can be read against it. Versions are what
`package.json` pins today.

## Shape

- **One Node process** serves the browser and runs the agent. No second service, no queue.
- **One SQLite file** holds conversations, entries, and runs. `pi-durable` writes it.
- **One browser bundle** built by Vite. The server is never bundled.

## Chosen

| Layer      | Choice                                 | Why                                                                        | Cost                                                              |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Runtime    | Node 26                                | Runs `.ts` directly by type stripping: no build, no watcher for the server | Imports need the `.ts` extension; erasable syntax only            |
| Language   | TypeScript 7, `strict`, `noEmit`       | Vite and Node strip types; `tsc` only checks                               | Nothing is emitted, so no declaration files                       |
| UI         | React 19                               | Known; the ecosystem `shadcn` copies expect                                | A virtual DOM we do not need for a mostly-append-only transcript  |
| Build      | Vite 8, root `web/`, output `dist/`    | Fast HMR on the client, nothing on the server                              | Two module systems to keep apart                                  |
| Styles     | Tailwind 4 through `@tailwindcss/vite` | No `tailwind.config.js`; design tokens live in CSS `@theme`                | Class strings are long; needs `sortTailwindcss`                   |
| Components | `shadcn/ui`, copied in on demand       | The code lands in the repo, so it can be edited freely                     | Each component brings Radix packages                              |
| Icons      | `lucide-react`                         | What `shadcn` expects                                                      | One dependency for tree-shaken icons                              |
| Agent      | `@earendil-works/pi-durable` 1.4.0     | Tools, durable state, model turns, subagents, tasks, extensions            | Marked experimental upstream: the API may change between releases |
| Lint       | `oxlint`                               | Fast, no plugin zoo                                                        | Rule coverage is smaller than ESLint's                            |
| Format     | `oxfmt`                                | 4 spaces, 100 columns, sorted imports and Tailwind classes                 | Young tool; formatting may shift between versions                 |
| Packages   | pnpm 11                                | Matches the other repos                                                    | —                                                                 |

`@/` maps to `web/src`.

## What we did not take

- **`pi-coding-agent`**: needed only to read Pi's own folder (`~/.pi/agent`: logins, models,
  skills, `AGENTS.md`). Add it when provider login appears, as its own decision.
- **Access control**: no accounts, roles, invites, sharing, take-turns.
- **Infrastructure**: no worktrees, spend limits, gallery, push notifications, PR watches.
- **Front-end libraries**: no state library, no router, no component framework. One hand-written
  store; the sidebar is the only navigation until there are real URLs.
- **Server tooling**: no bundler, no nodemon. `node --watch` is enough.

## Rules the stack imposes

1. Server files import with the `.ts` extension: `import { x } from "./db.ts"`.
2. Server files use erasable syntax only: no `enum`, no parameter properties, no `namespace`.
3. Client files never import from `server/`. The only contract is HTTP and the event stream.
4. The browser learns state from the server's event stream. No polling loops.
5. The server binds `127.0.0.1`. With no sign-in, that binding **is** the security model.

## Open

- **Transport**: SSE plus plain `POST`s (working assumption: `pi-durable` already hands out an
  event stream), or WebSocket if the client ever needs to stream upward.
- **Storage layout**: one SQLite file for everything, or one per conversation. Assumption: one
  file, `@earendil-works/pi-durable/storage/sqlite/node`.
- **Theme**: Catppuccin in `web/src/styles/catppuccin.css`, imported once from `styles.css`, with
  one variable block per flavor behind `[data-flavor="…"]`. No colour literals in components.
- **Model login**: whether we read `~/.pi/agent` as-is or keep our own settings file.
