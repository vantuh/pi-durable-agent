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
  src/shell/                 sidebar, conversation frame, status bar, settings
  src/transcript/            turns, tool-call folding
  src/composer/              input, model chip, send and stop
  src/ui/                    renderers two of the three share: markdown, diff, attachments,
                             the error boundary around one item
  src/sdk/                   event store, host calls
  src/lib/                   what the folders call: api.ts, conversation.ts, turns.ts, event.ts
  src/components/ui/         shadcn primitives, imported through the `@/` alias
  src/styles/                catppuccin.css, styles.css
agents/            later     subagent definitions, Markdown with frontmatter
docs/                        decisions, written before code
```

A file goes in `shell/`, `transcript/` or `composer/` when one of them owns it. When two of them do,
it goes in `ui/` rather than making a feature import another feature.

Today `server/`, `shared/`, `web/src/` and `extensions/` exist: `server/` runs several conversations,
and `extensions/` holds `prompt`, `cache-hit`, `context-meter`, `tokens-per-second` and `git-branch`.
`agents/` is planned; do not pretend otherwise in a commit message.

## The extension contract

One folder per feature:

```text
extensions/files/
  server.ts      default export (host) => the tools, prompt sections, and hooks it installs;
                 may also export `status` and `actions`
  server.test.ts its tests; `pnpm test` runs `test/` and `extensions/`
  refs.ts        action refs and types shared by `server.ts` and `web.tsx`, safe for the browser
  web.tsx        what it adds to the browser: status-bar items and settings sections
  api.ts         its typed contract: what other extensions may call, and its tier  (not built yet)
```

- **One folder, one extension, named after the folder.** The loader replaces by name, so a name
  that drifts installs twice. `coding-tools` is reserved by the core.
- **Dependencies will be declared, not imported** (`api.ts` with `need` / `want`) once there is a
  second extension that needs the first. Until then: no extension imports another.
- **The loader loads live.** A folder is installed on save, kept as it was when its file breaks,
  and uninstalled when the folder goes. `GET /api/extensions` says what is installed and what
  failed.

Model it on `ultimate/shared/extension-api.ts` and `ultimate/server/extensions.ts`; do not invent a
second mechanism.

## Layers and how they reload

| Path                          | Holds                                                                                           | Goes live by                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `server/`, `shared/`          | HTTP, SSE, harness, loader, protocol                                                            | Restart the process (`node --watch`)                      |
| `web/`                        | Shell, transcript, composer, store                                                              | Vite HMR, instantly                                       |
| `extensions/*/web.tsx`        | Status items, settings sections                                                                 | Vite HMR on change; a deleted file reloads the page       |
| `extensions/*/server.ts`      | Tools, prompt sections, hooks, `status`, `actions`, and the helper files it imports (`refs.ts`) | Reinstalled on save; running calls finish on the old code |
| `extensions/*/server.test.ts` | Its tests                                                                                       | Not loaded; run by `pnpm test`                            |
| `extensions/*/api.ts`         | Its typed contract                                                                              | With the facets that import it                            |
| `agents/`                     | Subagent definitions                                                                            | Read at each use                                          |

## How we build, in order

1. ~~**`server/main.ts` + `shared/protocol.ts`.** One conversation, `GET /api/events` (SSE),
   `POST /api/messages`.~~ **Done**: `curl` shows streamed tokens and a tool call
   ([docs/server.md](docs/server.md)).
2. ~~**`server/extensions.ts`.** Load `extensions/*/server.ts`, hand each a host, install what it
   returns.~~ **Done**, with `extensions/prompt` as the first extension: adding, breaking, and
   removing a folder all work live ([docs/extensions.md](docs/extensions.md)).
3. ~~**The theme.**~~ **Done**: Catppuccin in `web/src/styles/catppuccin.css`, four flavours
   behind `data-flavour`, roles in `styles.css`, Tailwind's palette deleted
   ([docs/theme.md](docs/theme.md)).
4. ~~**The shell, transcript and composer.**~~ **Done**: three panels with gaps, a status bar,
   the stream rendered, `Enter` sends, Stop aborts ([docs/layout.md](docs/layout.md)).
5. ~~**Tool calls** folded into one line per group, with the answer statistics.~~ **Done**:
   `web/src/lib/turns.ts` groups, `web/src/transcript/activity.tsx` folds. Answers render as Markdown (`web/src/ui/markdown.tsx`).
6. ~~**Sessions**: more than one conversation, titles and times stored, a real list, a folder
   picker.~~ **Done**: `web/src/shell/sessions.tsx`, `web/src/shell/folder-picker.tsx`,
   `GET`/`POST /api/sessions` ([docs/server.md](docs/server.md)).
7. **Features**, each a new `extensions/<name>/` folder; the planned ones and their sources are in
   [docs/extensions.md](docs/extensions.md).

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
- [ ] **No colour is ever invented.** Every colour is a `--role-*` name from the theme. No hex,
      no `rgb()`, no `oklch()`, no Tailwind palette class, no inline `style={{ color }}`, not
      even once and not even in dev. A colour that is missing gets a role added to
      `web/src/styles/styles.css` and a palette name in `styles/catppuccin.css` first, then the
      component uses it.
- [ ] No new dependency without the reason in the commit message.
- [ ] `@earendil-works/*` packages are pinned exactly: Pi Durable is experimental.

Every rule, and the mistake it prevents: [docs/conventions.md](docs/conventions.md).

## Decisions already made

- The agent is `@earendil-works/pi-durable`. Do not write an agent loop by hand.
- `@earendil-works/pi-coding-agent` is here for one reason only: `ModelRuntime.create()` reads Pi's
  own logins and models from `~/.pi/agent`. Do not use it for tools or the harness.
- `@earendil-works/chord` is a direct dependency for `BACKGROUND_CONTEXT`, nothing else.
- One user, one process, `127.0.0.1`. No auth, roles, or sharing until something needs them.
- Personal behaviour belongs in extensions, not in the core.
- The theme is Catppuccin, in its own file, defined once as CSS variables. A colour that does not
  exist there does not exist; the fix is to extend the theme, never to paint around it.
