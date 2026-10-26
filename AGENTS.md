# AGENTS.md

Working notes for an agent in this repository. Read [docs/](docs/README.md) before changing
anything structural; [docs/conventions.md](docs/conventions.md) is the rule set.

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
- [ ] `web/` never imports from `server/`.
- [ ] Colours come from `web/src/styles/catppuccin.css`; no colour literals in components.
- [ ] `oxfmt` owns layout. Do not hand-align code it will rewrite.

## Where things are

| Path                  | Holds                                                  |
| --------------------- | ------------------------------------------------------ |
| `web/src/`            | The browser app: React 19, Tailwind 4                  |
| `web/index.html`      | Vite entry                                             |
| `server/`             | Not created yet. Node 26, `pi-durable`, `.ts` directly |
| `docs/stack.md`       | Why each dependency is here                            |
| `docs/layout.md`      | The shell: sidebar, conversation, right drawer         |
| `docs/conventions.md` | Every rule, and the mistake it prevents                |

## Decisions already made

- The agent is `@earendil-works/pi-durable`. Do not write an agent loop by hand.
- One user, one process, `127.0.0.1`. No auth, roles, or sharing until something needs them.
- Personal behaviour belongs in extensions, not in the core.
