# Conventions

The code will mostly be written by an agent. These rules exist so that a mistake is caught by a
command, not by a person reading a diff.

## Two commands

```bash
pnpm check   # format check, lint with types, type check — must pass before "done"
pnpm fix     # format and auto-fix what can be fixed
```

`pnpm check` is the only gate. It fails on **warnings** too, so nothing accumulates as "later".

## What each guard catches

Verified by writing the mistake and watching it fail.

| Guard                                             | The mistake it catches                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `erasableSyntaxOnly`                              | `enum`, parameter properties, `namespace` — the server runs by type stripping, so these crash at run time |
| `noUncheckedIndexedAccess`                        | `xs[0]` treated as a value when the array may be empty                                                    |
| `exactOptionalPropertyTypes`                      | `{ a: undefined }` where `a?: string` means "absent"                                                      |
| `noUnusedLocals`, `noUnusedParameters`            | Half-finished refactors left behind                                                                       |
| `noImplicitReturns`, `noFallthroughCasesInSwitch` | A branch that silently returns `undefined`                                                                |
| `typescript/no-explicit-any`                      | The escape hatch of first resort                                                                          |
| `typescript/no-non-null-assertion`                | `value!.length` on something that may be `null`                                                           |
| `typescript/no-unsafe-type-assertion`             | `as SomeType` with no check behind it                                                                     |
| `typescript/no-floating-promises`                 | `fetch(...)` with no `await` and no `.catch`                                                              |
| `typescript/no-misused-promises`                  | An `async` function passed where `void` is expected                                                       |
| `typescript/require-await`, `await-thenable`      | `async` without `await`, `await` on a plain value                                                         |
| `typescript/switch-exhaustiveness-check`          | A new union member that no `switch` handles                                                               |
| `typescript/consistent-type-imports`              | Type imports that `verbatimModuleSyntax` will not strip                                                   |
| `import/no-cycle`                                 | Two modules importing each other                                                                          |
| `react/rules-of-hooks`, `react/exhaustive-deps`   | Hooks called conditionally, stale closures in effects                                                     |

## Colour

One rule, no exceptions: **a colour comes from the theme or it does not exist.**

- A component names a role: `text-muted`, `bg-panel`, `border-edge-soft`, or `var(--role-accent)`.
- A colour the themes lacks is added to `web/src/styles/catppuccin.css` (a palette name) and
  `web/src/styles.css` (a role), then used. Never a hex, `rgb()`, `oklch()`, Tailwind palette class,
  or inline `style` — not in a component, not in a dev page, not in a one-off border.
- Tailwind's own palette is deleted, so the wrong way does not compile to anything.

## Who owns what

- **`oxfmt` owns layout.** Nobody argues about spaces, quotes, import order, or Tailwind class
  order; `pnpm fix` decides. Markdown and JSON too.
- **`oxlint` owns correctness.** Type-aware rules are on: `oxlint --type-aware` uses the real
  TypeScript program, so `no-floating-promises` and friends are not guessing.
- **`tsc` owns types.** `noEmit`: Vite and Node strip types, `tsc` only checks them.

A disable comment is allowed only with the reason on the same line, and an unused disable is
itself an error.

## Server files

`server/**/*.ts` runs under `node`, which strips types without transforming:

- imports end in `.ts`: `import { db } from "./db.ts"`;
- no `enum`, no parameter properties, no `namespace`;
- no imports from `web/`.

## Browser files

`web/src/**` is bundled by Vite. `@/` is `web/src`. The client never imports from `server/`; the
only contract is HTTP and the event stream.
