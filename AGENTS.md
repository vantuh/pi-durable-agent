# pi-durable-agent

A local coding agent with a web interface, built on `@earendil-works/pi-durable`. One person, one
process, `127.0.0.1`. Pi's tools and Pi's system prompt; a screen that stays readable on a phone;
none of the feature set that comes with a product built for strangers.

It exists because Pi Pocket is someone else's app with eighty features, and Ultimate is someone
else's app with fifty-three extensions. We want the screen economy of the first and the shape of
the second, with only the parts we asked for — and our own additions as extensions, so the core
never has to grow to hold them.

## The idea: a thin core, everything else an extension

The core is small on purpose. It holds only what must be true for _every_ feature:

- who the agent is talking to (one person — nothing to check);
- the event stream, and the harness that produces it;
- the loader that installs extensions;
- the shell: sidebar, conversation, drawer;
- the transcript and the composer — the two things every feature draws into.

Everything else is a folder in `extensions/`. Files, changes, subagents, memory, plans, themes:
each one adds its own tools, its own prompt sections, and its own piece of UI, and can be deleted
without touching the core.

**The test question, asked before writing any file: "can this be an extension?"** If yes, it is
one. A change to the core needs a reason in the commit message — a real one, not "it was easier".

The core stays honest by two rules:

1. **One direction.** Core knows nothing about any extension by name. An extension knows about the
   core, and about other extensions only through their `api.ts`.
2. **Behaviour goes in an extension, not in `server/`**, whenever it can. An extension reloads; a
   core change needs a restart.

## Stack

| Layer    | Choice                                                              |
| -------- | ------------------------------------------------------------------- |
| Runtime  | Node 26, type stripping: `server/` files run as `.ts`, no build     |
| Language | TypeScript 7, `strict`, `erasableSyntaxOnly`                        |
| Server   | Plain `node:http` — no framework                                    |
| Agent    | `@earendil-works/pi-durable` 1.4.0, pinned exactly                  |
| Browser  | React 19, Vite 8                                                    |
| Styles   | Tailwind 4 through `@tailwindcss/vite`; Catppuccin as CSS variables |
| Checks   | `oxfmt`, `oxlint --type-aware`, `tsc --noEmit` — one gate           |

Reasons, costs, and what we deliberately did not take: [docs/stack.md](docs/stack.md).

## Where we copy from

Two checkouts on this machine are references. **Read them; never import them, never fork them.**

| Path                                               | What to take                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/vantuh/projects/opensource-test/pi-pocket` | **Screen craft.** `web/transcript.js` (turns, folding, tool timelines), `web/composer.js` (steer, queue, interrupt), `web/sessions.js` + `web/store.js` (list and event store), `web/diff.js` + `web/diff-parse.js`, `web/gestures.js` + `web/back.js` (phone navigation). `docs/features.md` is a shopping list of behaviours; `docs/extensions/policies/core-or-extension.md` is the core/extension test |
| `/Users/vantuh/projects/opensource-test/ultimate`  | **Core/extension split.** `shared/extension-api.ts` (`Api`, `defineApi`, `DocRef`, `ActionRef`, the `coreTier` line, `need`/`want`), `server/extensions.ts` (the loader), `web/src/sdk/` (the browser half), `extensions/subagents/` (one whole feature as a folder), `AGENTS.md` (the layers table), `docs/running.md` (reload rules)                                                                     |

Rules for copying:

- **One file at a time, rewritten.** Their code assumes their core. Port the idea, then write the
  file to fit ours.
- **Do not copy what you do not understand.** A file you cannot explain is a file you cannot
  change.
- **Keep the notice.** Both are MIT. A file with a substantial part copied from one keeps its
  copyright line.
- **Not this:** accounts, roles, invites, sharing, take-turns, spend limits, worktrees, gallery,
  push notifications, PR watches, PiP. Each is a decision, not a default.

## Target shape

```text
server/            core      HTTP, SSE, harness, extension loader
shared/            core      protocol.ts — the only contract the browser sees
extensions/<name>/ extension server.ts · web.tsx · api.ts
web/               core      React shell
  src/shell/                 sidebar, conversation frame, drawer
  src/transcript/            turns, tool-call folding
  src/composer/              input, model chip, send and stop
  src/sdk/                   event store, host calls
  src/styles/                catppuccin.css, styles.css
agents/            later     subagent definitions, Markdown with frontmatter
docs/                        decisions, written before code
```

Today only `web/src/{main.tsx,App.tsx,lib/utils.ts}` exists. `server/`, `shared/`, `extensions/`
and `agents/` are planned; do not pretend otherwise in a commit message.

## The extension contract

One folder per feature:

```text
extensions/files/
  server.ts    default export (host) => the tools, prompt sections, and hooks it installs
  web.tsx      what it adds to the browser: a rail button, a panel, a sheet
  api.ts       its typed contract: what other extensions may call, and its tier
```

- **Dependencies are declared, not imported.** An extension reaches another through its `api.ts`
  with `need` (required) or `want` (optional). A cycle is an error, not a style question.
- **A core-tier extension is always on**, declares `export const tier = 'core'` in its `api.ts`,
  and may depend only on other core-tier extensions. Everything else is optional and off-able.
- **The loader is the first thing we build**, before any feature. An extension that cannot be
  added and removed cleanly is a core change hiding in a folder.

Model it on `ultimate/shared/extension-api.ts` and `ultimate/server/extensions.ts`; do not invent a
second mechanism.

## Layers and how they reload

| Path                     | Holds                                | Goes live by                                              |
| ------------------------ | ------------------------------------ | --------------------------------------------------------- |
| `server/`, `shared/`     | HTTP, SSE, harness, loader, protocol | Restart the process (`node --watch`)                      |
| `web/`                   | Shell, transcript, composer, store   | Vite HMR, instantly                                       |
| `extensions/*/web.tsx`   | UI an extension adds                 | Vite HMR, instantly                                       |
| `extensions/*/server.ts` | Tools, prompt sections, hooks        | Reinstalled on save; running calls finish on the old code |
| `extensions/*/api.ts`    | Its typed contract                   | With the facets that import it                            |
| `agents/`                | Subagent definitions                 | Read at each use                                          |

## How we build, in order

1. **`server/main.ts` + `shared/protocol.ts`.** One conversation, `GET /api/events` (SSE),
   `POST /api/messages`. Done when `curl` shows streamed tokens.
2. **`server/extensions.ts`.** Load `extensions/*/server.ts`, hand each a host, install what it
   returns. Done when one throwaway extension adds a prompt section and can be deleted.
3. **The shell** — [docs/layout.md](docs/layout.md), step 1. Three regions, no data.
4. **The transcript** from the event stream. 5. **The composer** with streaming and Stop.
5. **Tool calls** folded into one line per group.
6. **Features**, each a new `extensions/<name>/` folder: files, changes, subagents, memory.

## Before saying "done"

```bash
pnpm check     # must pass: format, type-aware lint, type check
pnpm fix       # repairs formatting and anything auto-fixable
```

`pnpm check` fails on warnings. A change is not finished while it fails.

## Non-negotiables

- [ ] Server imports end in `.ts`: `import { x } from "./db.ts"`.
- [ ] Server files use erasable syntax only: no `enum`, no parameter properties, no `namespace`.
- [ ] No `any`, no `!`, no `as` without a check that justifies it.
- [ ] Every promise is awaited or explicitly ignored with `void`.
- [ ] `web/` never imports from `server/`; extensions never import each other's files.
- [ ] Colours come from `src/styles/catppuccin.css`; no colour literals in components.
- [ ] No new dependency without the reason in the commit message.
- [ ] `@earendil-works/*` packages are pinned exactly: Pi Durable is experimental.

Every rule, and the mistake it prevents: [docs/conventions.md](docs/conventions.md).

## Decisions already made

- The agent is `@earendil-works/pi-durable`. Do not write an agent loop by hand.
- One user, one process, `127.0.0.1`. No auth, roles, or sharing until something needs them.
- Personal behaviour belongs in extensions, not in the core.
- The theme is Catppuccin, in its own file, defined once as CSS variables.
