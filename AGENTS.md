# pi-durable-agent

A local coding agent with a web interface, built on `@earendil-works/pi-durable`. One person, one
process, `127.0.0.1`. Pi's tools and Pi's system prompt; a screen that stays readable on a phone;
none of the feature set that comes with a product built for strangers. Overview for humans:
[README.md](README.md). Decisions and contracts: [docs/README.md](docs/README.md).

## The idea: a thin core, everything else an extension

The core is small on purpose. It holds only what must be true for _every_ feature:

- who the agent is talking to (one person — nothing to check);
- the event stream, and the harness that produces it;
- the loader that installs extensions;
- the shell: sidebar, conversation, drawer;
- the transcript and the composer — the two things every feature draws into.

Everything else is a folder in `extensions/`. Each one adds its own tools, prompt sections, and
piece of UI, and can be deleted without touching the core. A new feature is a new
`extensions/<name>/` folder. The installed ones are listed in [README.md](README.md#extensions) and
[docs/extensions.md](docs/extensions.md#extension-guides).

**The test question, asked before writing any file: "can this be an extension?"** If yes, it is
one. A change to the core needs a reason in the commit message — a real one, not "it was easier".

The core stays honest by two rules:

1. **One direction.** Core knows nothing about any extension by name. An extension knows about the
   core, and never imports another extension's files.
2. **Behaviour goes in an extension, not in `server/`**, whenever it can. An extension reloads; a
   core change needs a restart.

## Stack

| Layer    | Choice                                                              |
| -------- | ------------------------------------------------------------------- |
| Runtime  | Node 26, type stripping: `server/` files run as `.ts`, no build     |
| Language | TypeScript 7, `strict`, `erasableSyntaxOnly`                        |
| Server   | `node:http` for the socket, Hono 4 for the route table              |
| Input    | Zod 4 schemas beside the routes, `@hono/zod-validator`              |
| Agent    | `@earendil-works/pi-durable` 1.5.0, pinned exactly                  |
| Browser  | React 19, Vite 8                                                    |
| Styles   | Tailwind 4 through `@tailwindcss/vite`; Catppuccin as CSS variables |
| Checks   | `oxfmt`, `oxlint --type-aware`, `tsc --noEmit` — one gate           |

Reasons, costs, and what we deliberately did not take: [docs/stack.md](docs/stack.md).

## Where we copy from

Two checkouts on this machine are references. **Read them; never import them, never fork them.**

| Path                                               | What to take                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/vantuh/projects/opensource-test/pi-pocket` | **Screen craft.** `web/transcript.js` (turns, folding, tool timelines), `web/composer.js` (steer, queue, interrupt), `web/sessions.js` + `web/store.js` (list and event store), `web/diff.js` + `web/diff-parse.js`, `web/gestures.js` + `web/back.js` (phone navigation). `docs/features.md` is a shopping list of behaviours; `docs/extensions/policies/core-or-extension.md` is the core/extension test |
| `/Users/vantuh/projects/opensource-test/ultimate`  | **Core/extension split.** `shared/extension-api.ts`, `server/extensions.ts` (the loader), `web/src/sdk/` (the browser half), `extensions/subagents/` (one whole feature as a folder), `AGENTS.md` (the layers table), `docs/running.md` (reload rules)                                                                                                                                                     |

Rules for copying:

- **One file at a time, rewritten.** Their code assumes their core. Port the idea, then write the
  file to fit ours.
- **Do not copy what you do not understand.** A file you cannot explain is a file you cannot
  change.
- **Keep the notice.** Both are MIT. A file with a substantial part copied from one keeps its
  copyright line (an extension keeps it in a `LICENSE.*` beside the code).
- **Not this:** accounts, roles, invites, sharing, take-turns, spend limits, gallery, PR watches,
  PiP. Each is a decision, not a default.

## Target shape

```text
server/            core      HTTP, SSE, harness, extension loader (server/extensions/)
shared/            core      protocol.ts — the only contract the browser sees
extensions/<name>/ extension see below
web/src/           core      React shell
  shell/                     sidebar, conversation frame, status bar, settings
  transcript/                turns, tool-call folding
  composer/                  input, model chip, send and stop
  ui/                        renderers two of the three share: markdown, diff, attachments,
                             the error boundary around one item
  sdk/                       what extensions' web halves call: actions, commands, composer
  lib/                       what the folders call: api.ts, conversation.ts, turns.ts, event.ts
  components/ui/             shadcn primitives, imported through the `@/` alias
  styles/                    catppuccin.css, styles.css
test/                        core tests (extensions keep theirs beside server.ts)
docs/                        what the code is, as it is
```

A file goes in `shell/`, `transcript/` or `composer/` when one of them owns it. When two of them do,
it goes in `ui/` rather than making a feature import another feature. One exported component per
file, and how a folder splits when it grows: [docs/conventions.md](docs/conventions.md#file-and-folder-structure).

## The extension contract

```text
extensions/<name>/
  package.json   `@pi-durable-agent/<name>` and the extension's own dependencies
  server.ts      default export (host) => the tools, prompt sections, and hooks it installs;
                 may also export `status` and `actions`
  server.test.ts its tests; `pnpm test` runs `test/` and `extensions/`
  README.md      usage, configuration, behaviour and limits; every extension has one
  refs.ts        action refs and types shared by both halves; browser-safe, no Node imports
  web.tsx        status-bar items, panels, settings sections
  details.tsx    what the Extensions dialog shows about it
  server/        server-only code server.ts imports; Node allowed
  web/           browser-only code web.tsx imports: components, use-*.ts hooks
  assets/  fixtures/  LICENSE.*
```

- **The top level holds only the names above**; everything else goes into `server/` or `web/` by
  where it runs (`test/extension-layout.test.ts` fails otherwise). Full layout:
  [docs/extensions.md](docs/extensions.md#the-layout).
- **One folder, one extension, named after the folder.** The loader replaces by name, so a name
  that drifts installs twice. `coding-tools` is reserved by the core.
- **Core server code comes from `server/sdk.ts` only.** oxlint enforces it.
- **Documentation lives with the extension**, in its `README.md`. Shared contracts stay in
  `docs/extensions.md`.
- **There is no `api.ts`, `need` or `want` yet.** The two halves of one extension share `refs.ts`;
  nothing is shared between extensions. Build the dependency mechanism only when a second extension
  needs the first, modelled on `ultimate/shared/extension-api.ts`; do not invent a second one.
- **The loader loads live.** A folder is installed on save, kept as it was when its file breaks,
  and uninstalled when the folder goes. `GET /api/extensions` says what is installed and what
  failed.

## Layers and how they reload

| Path                           | Holds                                                                        | Goes live by                                              |
| ------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `server/`, `shared/`           | HTTP, SSE, harness, loader, protocol                                         | The restart button in Settings (`POST /api/restart`)      |
| `web/`                         | Shell, transcript, composer, store                                           | Vite HMR, instantly                                       |
| `extensions/*/web.tsx`, `web/` | Status items, panels, settings sections                                      | Vite HMR on change; a deleted file reloads the page       |
| `extensions/*/server.ts`       | Tools, prompt sections, hooks, `status`, `actions`, `refs.ts`, its `server/` | Reinstalled on save; running calls finish on the old code |
| `extensions/*/server.test.ts`  | Its tests                                                                    | Not loaded; run by `pnpm test`                            |

## Before saying "done"

```bash
pnpm check     # must pass: format, type-aware lint, type check
pnpm test      # node --test on test/ and extensions/
pnpm fix       # repairs formatting and anything auto-fixable
```

`pnpm check` fails on warnings. A change is not finished while it fails.

Plans and scratch notes go in `plans/` (git-ignored), never in `docs/`. `docs/` describes the code as
it is.

## Non-negotiables

- [ ] Server imports end in `.ts`: `import { x } from "./db.ts"`.
- [ ] Server files use erasable syntax only: no `enum`, no parameter properties, no `namespace`.
- [ ] No `any`, no `!`, no `as` without a check that justifies it.
- [ ] Every promise is awaited or explicitly ignored with `void`.
- [ ] Tests and standalone Harness checks use disposable databases, never the working `data/state.sqlite`.
      Test servers set `PI_DURABLE_DATA_DIR` to a temporary folder and use a free `PORT`.
- [ ] `web/` never imports from `server/`, except `import type { AppType }` from
      `server/app-type.ts` for the typed client (oxlint enforces it); extensions never import each
      other's files.
- [ ] **No colour is ever invented.** Every colour is a `--role-*` name from the theme. No hex,
      no `rgb()`, no `oklch()`, no Tailwind palette class, no inline `style={{ color }}`, not
      even once and not even in dev. A colour that is missing gets a role added to
      `web/src/styles/styles.css` and a palette name in `styles/catppuccin.css` first, then the
      component uses it.
- [ ] **Every other design value comes from the theme too.** Font size, line height,
      shadow, and the named spacing (`stripe`, `header`) are theme names (`text-meta`,
      `shadow-float`, `min-h-header`); other spacing is Tailwind's scale. No
      `rounded-[4px]`, `text-[11px]`, `shadow-lg`, or `px-[7px]`: a value used twice gets a name in
      `styles.css` (and in `cn`'s merge config), a value used once snaps to the nearest name. An
      arbitrary value stays only when it is computed (viewport, container, `lh`) or one component's
      own measured drawing, with the reason beside it. A shared look is a primitive, a variant, or a
      `web/src/ui/` part — never a class string copied into a second file.
- [ ] No new dependency without the reason in the commit message.
- [ ] `@earendil-works/*` packages are pinned exactly: Pi Durable is experimental.

Every rule, and the mistake it prevents: [docs/conventions.md](docs/conventions.md).

## Decisions already made

- The agent is `@earendil-works/pi-durable`. Do not write an agent loop by hand.
- `@earendil-works/pi-coding-agent` is here for one reason only: `ModelRuntime.create()` reads Pi's
  own logins and models from `~/.pi/agent`. Do not use it for tools or the harness.
- `@earendil-works/chord` is a direct dependency for `BACKGROUND_CONTEXT` and the context helpers:
  `withCancel` derives the child context that lets `bash-timeout` kill one idle command without
  cancelling its caller. Nothing else.
- One user, one process, `127.0.0.1`. No auth, roles, or sharing until something needs them.
- Personal behaviour belongs in extensions, not in the core.
- The theme is Catppuccin, in its own file, defined once as CSS variables. A colour that does not
  exist there does not exist; the fix is to extend the theme, never to paint around it.
