# Conventions

The code will mostly be written by an agent. These rules exist so that a mistake is caught by a
command, not by a person reading a diff.

## Two commands

```bash
pnpm check   # format check, lint with types, type check — must pass before "done"
pnpm fix     # format and auto-fix what can be fixed
```

`pnpm check` is the only gate. It fails on **warnings** too, so nothing accumulates as "later".

## Commit messages

`pnpm install` enables `.githooks` through the `prepare` script. The `commit-msg` hook runs
commitlint with `@commitlint/config-conventional`, rejecting messages that do not follow
Conventional Commits, for example `fix(ui): keep the composer visible`.

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
  `web/src/styles/styles.css` (a role), then used. Never a hex, `rgb()`, `oklch()`, Tailwind palette class,
  or inline `style` — not in a component, not in a dev page, not in a one-off border.
- Tailwind's own palette is deleted, so the wrong way does not compile to anything.

## Every other design value

The same rule for the rest of the look, so a change to the theme reaches every screen by itself.

- **Names, not numbers.** Font size
  (`text-meta`, `text-code`, `text-ui`, `text-interface`, `text-subheading`,
  `text-heading`), shadow (`shadow-float`), and the named spacing (`w-stripe`, `min-h-header`) live
  in `web/src/styles/styles.css`. Other spacing uses Tailwind's scale (`p-3`, `max-w-48`).
- **A second use earns a name.** A value used twice is added to the theme and to `cn`'s merge config
  in `web/src/lib/utils.ts`, so a caller's token always replaces a primitive's base. A value used
  once snaps to the nearest name.
- **An arbitrary value needs a reason.** Allowed: viewport and container calculations, `lh` heights,
  `transition-[…]` lists, grid templates, arbitrary selectors, and one component's own measured
  drawing — the last with a one-line comment saying what it measures.
- **One focus ring.** A focusable element draws `focus-visible:ring-2 focus-visible:ring-accent`
  (inset where it fills a scrolling column); a chosen state that must show beside focus uses
  `inset-ring`.
- **A shared look has one home.** A primitive in `components/ui/`, a variant or size on it, or a part
  in `web/src/ui/` (`PANE`, `PaneHeader`, `Toolbar`, `Loading`, `DetailsColumn`, `DetailsNote`). A
  class string copied into a second file is the mistake this prevents.

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
- no imports from `web/`;
- **name a Pi type by its export, not by `Parameters<...>`** of an overloaded method: `Parameters`
  reads the last overload (`Conversation.submit`'s is the `Tx` one), and `Extract` over it ends in
  `never` without an error where the type is made. Use `UserInput` and the other exported types.
- **A stream frame carries what the browser lacks, by id.** Entry ids only grow and the browser
  upserts by id, so `publish` sends the entries above `Opened.newestSent`; it never compares the
  window with the last one, because the view window trims its oldest entries.

## Browser files

`web/src/**` is bundled by Vite. `@/` is `web/src`. The client never imports from `server/`, except
`import type { AppType }` from `server/app-type.ts`, which types `hc` in `web/src/lib/api.ts`
(oxlint's `no-restricted-imports` rejects any other `server/` path under `web/`). The rest of the
contract is the event stream and `shared/`.

- **`web/src/lib/api.ts` is the one place that calls `hc`.** Components call its functions; the
  response types are inferred (`InferResponseType`), not written again. A URL the browser needs as a
  string (an `EventSource`, an `img`'s `src`) is an exported helper over `$path()`.
- **A call checks `response.ok` through `ok()`**, which throws `/path?query: status`, or reads the
  failure body from `response.json()`. The mistake it prevents: a 400 read as the success type.
- **A raw write has no response type.** The routes that end in `RESPONSE_ALREADY_SENT` give `hc`
  an `unknown` body, so the call parses it as before (`sessionsOf`, `parseHistory`).
- **`hc` does not encode a path parameter**: pass `encodeURIComponent(name)`. A raw body goes in
  `init: { body }` of the call's second argument, with its headers in `headers`.

## File and folder structure

Where a file goes is decided by these rules, not by taste, so an agent adding a feature never has to
invent a place for it. The code is still being moved to match them; until then, the rule wins over
the neighbour it disagrees with.

### Components

- **One exported component per `.tsx`, named after the file in kebab-case.** `sessions-status.tsx`
  exports `SessionsStatus`; a second export is a second file. A helper used only inside that file
  stays there, unexported. The exception is a shadcn primitive in `web/src/components/ui/`, which
  keeps its compound API (`Dialog`, `DialogContent`, …) together.
  The mistake it prevents: `panel.tsx` exporting four components, so nothing can be found by name.
- **~300 lines is a signal, not a limit.** Past it, split by responsibility: the data and state in a
  hook, the pure logic on its own, the view in the component. A hook with real logic lives in a
  `use-*.ts` file next to the component that owns it, never inline in the view.
- **A feature folder splits by sub-feature, not by kind.** `web/src/shell`, `transcript` and
  `composer` grow a subfolder when they pass ~8 files (`composer/model-menu/`), never a shared
  `components/` or `hooks/` folder. The mistake: one `hooks/` that everything half-belongs to.

### Server

- **Routes are HTTP, services hold behaviour.** `server/routes/` parses, validates, calls, answers —
  nothing else. Behaviour sits in a service beside the routes (`server/sessions.ts`,
  `server/history.ts`). `server/main.ts` is the composition root: build the dependencies, wire the
  routes, start listening; it keeps no long-lived state of its own.
- **A service with state is a factory that takes what it needs** (`conversationStream`, `sessionsStream`,
  `extensionSessions`), not a module with `let`s that `boot` fills in. What does not exist yet when it is
  built is passed as a function (`sessions: () => sessions`): the extensions' host calls back into the streams,
  and the sessions open after the extensions load, so the cycle is real and the function says where it is.
  The mistake it prevents: module-level state that a test or a second caller cannot construct twice.
- **A subsystem that outgrows one file becomes a folder** (`server/extensions/`), with an `index.ts`
  only when that keeps import paths stable.
- **Lower layers never import higher ones.** `server/http.ts` and `server/projection.ts` know nothing
  of `routes/` or `extensions/`; oxlint's `no-restricted-imports` rejects it. What both sides need goes
  down into a leaf (`server/errors.ts`, `server/image-types.ts`, `server/user-entry.ts`). The mistake it
  prevents: a projection that reaches for the extension loader, so neither can be tested without the
  other.
- **A subsystem splits by who owns its state, not by method.** In `server/extensions/` the loader
  (`extensions.ts`) is the one owner of what is installed and what each version registered; the
  files around it hold no state of theirs that it reads (`contract.ts`, `module-exports.ts`,
  `discovery.ts`, `collision.ts`, `listeners.ts`), or own a state of their own that it only calls into
  (`versions.ts`, `watcher.ts`), or build something for it (`host.ts`). A seam that would need the
  loader's private maps passed in to work is not cut.
- **A guard on `server/` reaches into its subfolders**, so `**/server/*` is not enough: the single star stops
  at the first folder, and a file in `server/extensions/` was not covered. For `web/` it is `**/server/**`. For
  `extensions/` the pattern lists the paths that climb out of the extension (`../../server/**`, `../../../server/**`,
  ...), because an extension's own `server/` folder is allowed; `test/lint-extension-imports.test.ts` pins both.

### Hono routes

- **A route factory has no return type annotation.** `Hono<ApiEnv>` as a return type resets the route
  schema to blank, and the browser's `hc` client loses every endpoint. Chain the routes and let
  inference carry them.
- **Answer with `c.json(body, status)`**, never `c.notFound()` or a hand-written JSON write: only the
  first gives `hc` a typed status.
- **A raw write returns `RESPONSE_ALREADY_SENT`**, and nothing else writes after it. Raw writes are
  for the event streams, byte answers, and extension HTTP; anything else is a Hono answer.
- **Never build a `Request` from `c.req.raw`.** On Node 26.11 and later `new Request(url, c.req.raw)`
  throws `ERR_INVALID_THIS` (honojs/node-server#408).
- **`c.req.path` and `c.req.param()` are decoded.** Where the exact bytes matter (a path handed on to
  an extension, a strict decode that must reject `%ZZ`), read `new URL(c.req.url).pathname`.
- **A route reads its JSON body through `jsonBody(schema, message)`** (`server/validate.ts`), and its
  handler reads the result from `c.req.valid("json")`. Not Hono's own JSON validator, which needs a JSON
  `Content-Type`, refuses an empty body and has no size limit; `hono/body-limit` would add the limit, but
  for a chunked body it builds `new Request(c.req.raw)`, which breaks on Node 26.11 and later (see
  above). `jsonBody` goes through `readJson`, so the 100 MB limit (413) and "body is not JSON" (400)
  stay. The mistake it prevents: a client without `Content-Type: application/json` silently sending
  `{}`.
- **A schema is named after its request (`TitleBody`, `HistoryQuery`) and lives in the route file that
  uses it.** A schema the browser needs at run time moves to `shared/` when it does.
- **A query goes through `queryOf(schema, message)`** (`zValidator("query")` with the same refusal). A
  number in it is `QueryNumber.pipe(PositiveId)`: `QueryNumber` reads the text as `Number(text)` does
  (the code that read `Number(c.req.query(key))` keeps its meaning), and the schema's input stays a
  string for `hc`. A key sent twice arrives as an array and fails a string field.
- **The schema checks the shape; the handler keeps the checks that need state or an order.** "Session
  not found" (404) and "text is required" (400, only after the session is found) stay in the handler,
  so the order of answers does not change.
- **A refusal is one sentence per route** (`jsonBody`'s `message`, a string or a function of the path of
  the first failing field), answered as `{ error }` with 400. The mistake it prevents: Zod's issue list
  reaching a browser that shows `error` as text.
- **A field the route always ignored when mistyped is `lenient(...)`**, not strict: a body that worked
  before keeps working. A field with a fallback value is `.default(x).catch(x)`: `.catch` alone leaves
  the key required in `z.input`, and `hc` would demand it. `test/route-inputs.types.ts` holds the least
  input of every route.
- **A strict enum a screen holds as a `string` is `z.string().pipe(z.enum(...))`** (`ThinkingLevel`
  in `server/validate.ts`). The check is the same and so is the refusal, but `z.input` stays `string`,
  so the model menu's level reaches `hc` without a cast. `lenient(...)` and `.catch` keep the inner
  schema's input type, so the same goes inside them.
- **A caught failure is `failureOf(error, fallback)` and `c.json(body, status)`.** `status` is a
  `FailureStatus` (no 2xx), so `hc` reads the body as the failure and the rest as the success;
  `HttpError` takes the same type. `answerError` is `failureOf` written by hand, for the raw paths an
  extension owns. The mistake it prevents: a route that ends in `RESPONSE_ALREADY_SENT` in its `catch`,
  which makes its whole answer `unknown` to the browser.
- **`jsonBody` sets `changedSession`** from the body's `session`, whether or not the rest passes. A route
  never sets it. The mistake it prevents: a whole-list rebuild for one renamed session.

### Extensions and tests

- **Extension layout:** the top level holds only `package.json`, `README.md`, the entries
  `server.ts`, `web.tsx` and `details.tsx`, `server.test.ts`, `refs.ts`, and `LICENSE.*`; every other
  file goes into `server/` (Node allowed), `web/` (browser only), `assets/` or `fixtures/`. The
  mistake it prevents: thirty files at the top of one folder, and a Node import found by Vite late.
  The full layout: [refactor-plan.md](refactor-plan.md#the-layout). Current extensions do not all
  follow it yet; the refactor moves them.
- **A tool describes its parameters with `@earendil-works/pi-schema`** (`obj`, `str`, `int`, `opt`, ...),
  declared in the `dependencies` of the extension that imports it, never with TypeBox and never as a
  peer (a peer must also be in the root manifest). `obj` is closed by default and `Type.Object` was open:
  a schema that accepted extra keys before is `obj(..., { open: true })`, and a closed one stays
  closed on purpose. An extension that builds a tool schema pins the schema it installs in its
  `server.test.ts` (not the provider payload: pi-ai converts that per provider). The mistake it prevents: a rewrite that starts refusing the keys a model adds.
- **Tests share their setup.** The free `PORT`, the temporary `PI_DURABLE_DATA_DIR` and the test
  server live in `test/fixtures/`, imported rather than copied. The mistake it prevents: sixty copies
  of a start-up that drift into writing the working `data/state.sqlite`.
- **A copy of the working database is not disposable.** A server started on it resumes the runs that
  were in flight and runs their tools for real, with the owner's logins. Try a build against real data
  only with `HOME` pointed at an empty folder, so a resumed run finds no login and stops before a
  tool call. The mistake it prevents: a smoke test that re-ran the very conversation that started it.
- **A fake server in a browser test answers the real shape of every route the shell reads**, through
  `defaultAnswer()` in `test/fixtures/api-defaults.ts`. The
  typed client no longer falls back for a missing field (`/api/extensions` answering `{}` once gave an
  empty list, and now leaves the shell waiting). `test/api-client.test.ts` runs the client against the
  real server; it is where a route's wire format is pinned.
