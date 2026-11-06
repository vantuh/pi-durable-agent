# TypeBox to pi-schema

Phase 5 of [refactor-plan.md](refactor-plan.md): replace `typebox` with `@earendil-works/pi-schema` in
the tool definitions. Optional. **Done**: no file of ours imports `typebox`, and no `package.json`
declares it. Two tools' JSON changed (`mcp` and `browser`; see the mapping); the rest is identical,
pinned by a schema test in each extension's `server.test.ts`.

## Status

- [x] 1. Test-only schemas: only `extensions/bash-timeout/server.test.ts` still used TypeBox.
      `test/session-prompt.test.ts` and `extensions/context-meter/server.test.ts` already write plain
      JSON or no schema at all (Phase 4 did them).
- [x] 2. `web-fetch`
- [x] 3. `mcp`
- [x] 4. `web-search`
- [x] 5. `subagents`
- [x] 6. `browser`
- [x] 7. Remove `typebox`: the declarations left with their extensions, one commit each, so this
      step only confirmed it. `pnpm why typebox` lists it once, under `@earendil-works/pi-coding-agent`
      1.5.0 (which `ModelRuntime` needs) and nothing of ours.

Claims carry a tag. **[V]** verified against a named source: the pi-schema README or CHANGELOG from the
1.5.0 checkout, the pi-durable 1.5.0 changelog, our code, or the output of a command run here.
**[I]** inferred. **[U]** not checked. Line numbers are those of this checkout.

## Part 1: Documentation

### What pi-schema is

`@earendil-works/pi-schema` 1.5.0, released 2026-11-02 [V: CHANGELOG]. JSON Schema builders and a
validator that never calls `eval` or `new Function`. No dependencies; 8.5 KB minified and gzipped
[V: README].

- **Builders** return plain JSON Schema, typed with the values it accepts. The 1.5.0 list is `str`,
  `num`, `int`, `bool`, `nul`, `unknown`, `lit`, `oneOf`, `obj`, `opt`, `arr`, `tuple`, `map`,
  `union`, `nullable`, `bytes` [V: README table, and the 1.5.0 changelog entry]. Every builder also
  takes `title`, `description`, `examples`, `deprecated` and `default`. A `default` is an annotation
  and is never inserted.
- **`compile(schema, options)`** takes any JSON Schema (drafts 2020-12 and 7), built with the
  builders or not, and returns a validator: `check(value)` (a boolean and a type guard) and
  `errors(value)` (JSON Pointer paths, `[]` when valid) [V: README].
- **`compile(schema, { coerce: true })`** adds `coerce(value)` and `parse(value)` for loosely typed
  input such as a model's arguments: optional `null`s dropped, the rules of TypeBox 1.3.27's
  `Value.Convert` (the version we pin), then Ajv-style primitive coercion. `parse` coerces, then
  checks, and returns `{ ok: true, value }` or `{ ok: false, errors }` [V: README, CHANGELOG].
- **`Static<typeof schema>`** gives the TypeScript type. It also reads TypeBox 1.x schemas from their
  type shapes, without importing TypeBox: `String`, `Number`, `Integer`, `Boolean`, `Null`, `Literal`,
  `Array`, `Object` (with `Optional` and `Readonly`), `Union`, `Record`, `Unsafe`, `Unknown`, `Any`.
  Other TypeBox kinds (`Enum`, `Tuple`, `Intersect`, `Cyclic`, ...) give `unknown` [V: README].
  `compile` also accepts TypeBox 1.x schemas as they are [V: README, "TypeBox schemas"].
- **Objects are closed by default.** `obj({ ... })` emits `additionalProperties: false`;
  `obj({ ... }, { open: true })` allows other properties [V: README]. What `open: true` emits (nothing,
  or `additionalProperties: true`) is not stated [U].
- **Not supported:** TypeBox's JavaScript-only types, refinements and codecs [V: README]. The README
  and CHANGELOG mention no Zod or Standard Schema interop [V]; that there is none is inferred [I].

#### Only after 1.5.0: do not use yet

Everything below is under `[Unreleased]` in the CHANGELOG [V]. A pinned `1.5.0` does not have it.

- `unsafe<T>(schema)`, the equivalent of `Type.Unsafe`.
- `recursive<T>(id, build)`.
- `Validator.validate(value)`: no coercion, returns `{ ok, value }` or `{ ok, errors }`.
- `equal(a, b)`, the equivalent of `Value.Equal`.
- The `bigint()` builder, `{ type: "bigint" }` and `{ type: "undefined" }` validation, and `Static`
  for TypeBox `Enum`, `Tuple`, `BigInt`, `Undefined`.
- Fixes that change 1.5.0 behaviour: `num()` accepts `NaN` and `Infinity` in 1.5.0 (TypeBox does not);
  a required property set to `undefined` counts as missing in 1.5.0 even when its schema takes
  `undefined`; local `$ref`s fail when the root `$id` is a relative path with a directory. JSON
  carries none of these, so model arguments are not affected [I].

### Why upstream made it

TypeBox's compiler needs `eval`. Under a strict CSP it falls back to an interpreter: 44 µs per check
against 411 ns for pi-schema on the nested tagged-union case [V: README benchmark]. pi-schema checks
at the same speed with and without eval. 3,200 distinct tool-like schemas take 7.1 MB against 54.7 MB
for TypeBox [V: README benchmark]. The pi-durable 1.5.0 changelog says the built-in tools and
`structuredOutput` use pi-schema [V]; that MCP tools go through the same validator is [U]. The upstream
commits `fab2c53` and `6536f80` in `earendil-works/pi` were not opened [U]. The brief gave 7.9 MB for
the memory figure; the README says 7.1 MB, so this doc quotes the README.

### What changes for tools in pi 1.5

From the pi-durable 1.5.0 changelog [V: `/tmp/d15.md` line 5]:

- `defineTool()` and `ToolRegistration` take any JSON Schema object as `parameters` and
  `structuredOutputSchema`, and type `args` with pi-schema's `Static` (`ToolArgs<TParameters>`).
  TypeBox schemas give TypeBox's static type for the common kinds; any other schema gives `unknown`.
- The built-in tools are built with pi-schema, "with the same JSON Schema up to key order".
- `typebox` is no longer a dependency of pi-durable.
- The migration line: replace `Type.Object({ n: Type.Number() })` from `@earendil-works/pi-ai` with
  `obj({ n: num() })` from `@earendil-works/pi-schema` (closed by default; `{ open: true }` allows
  other properties).

So a TypeBox tool schema still type-checks and validates in 1.5, as long as it stays inside the common
kinds [I: the changelog and the README both say TypeBox schemas compile and type as they are]. The
upgrade itself is in [pi-1.5-migration.md](pi-1.5-migration.md) (being written).

Four more changes came with the brief and were **not found** in the pi-durable 1.5.0 changelog; a grep
for `refine`, `codec`, `Format.`, `Void` and `expected number` returns nothing [U]:

- `Type.Refine`, codecs and custom `Format.Set` formats stop working. The README does say that
  refinements and codecs are not supported by `compile` [V]. We use none (see the inventory).
- `Type.Void` rejects all arguments. We use none.
- Validation error text changes to the form `- limit: expected number, got string`. The README shows
  `expected integer, got string` in a `parse` error [V], not this exact line.
- `Type` is no longer exported from `@earendil-works/pi-ai`. The migration line above implies it [I].

### Honest value

One dependency fewer in six `package.json` files, and the same library the harness uses. No
functional gain for one local process: we do not run under a strict CSP, and the model sees the same
tool. Keeping TypeBox as a direct dependency is a valid end state, and Phase 4 of the plan already
assumes it. Do this only if the cost below is acceptable.

### Inventory

Searched `server/`, `shared/`, `extensions/`, `test/` and `web/src/` (not `node_modules`) for
`from "typebox"`, `Type` imported from `@earendil-works/pi-ai`, `Type.*`, `Static<`, `TSchema`,
`StringEnum`, `Value.*`, `TypeCompiler` and `Format.*` [V: grep]. Counts are occurrences of `Type.X`
in the lines given.

| File (lines)                                                    | Constructs                                                                        | Options                                                          | No exact pi-schema equivalent                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `extensions/web-fetch/server.ts:31-44`                          | Object 1, String 1, Integer 1, Optional 1                                         | `description`, `minLength: 1`, `minimum: 0`                      | none                                                            |
| `extensions/mcp/server.ts:85-93`                                | Object 1, Optional 3, String 3, Record 1, Unknown 1                               | `description`                                                    | `Record(String, Unknown)` to `map(unknown())` changes the JSON  |
| `extensions/web-search/server.ts:96-118`                        | Object 1, Optional 3, String 3, Array 2                                           | `description`, `minLength: 1` (2), `minItems: 1`, `maxItems` (2) | none                                                            |
| `extensions/subagents/server.ts:592-612, 727-730, 780, 815-819` | Object 4, Optional 3, String 8 (four tools: spawn, send, stop, status)            | `description`, `additionalProperties: false` (spawn only)        | none                                                            |
| `extensions/browser/server.ts:188-282`                          | Object 1, Optional 18, String 9, Number 4, Boolean 5, Union 1, Literal 1 (mapped) | `description`                                                    | `Union(ACTIONS.map(Literal))` to `lit`/`oneOf` changes the JSON |
| `extensions/bash-timeout/server.test.ts:430`                    | Object 1, String 1 (from `typebox`)                                               | none                                                             | none                                                            |
| `test/session-prompt.test.ts:71, 77`                            | Object 2, String 1 (`Type` from `pi-ai`)                                          | none                                                             | none                                                            |
| `extensions/context-meter/server.test.ts:111`                   | Object 1 (`Type` from `pi-ai`)                                                    | none                                                             | none                                                            |

Not used anywhere [V: grep]: `Static<`, `TSchema`, `StringEnum`, `Value.*`, `TypeCompiler`, `Format.*`,
`Refine`, codecs, `Void`, `Intersect`, `Ref`, `Recursive`, `Unsafe`, `structuredOutputSchema`. There
is no `Type.` in `server/`, `shared/` or `web/src/`. (The pattern also hit `contentType.split` in
`extensions/web-fetch/page.ts:59`; that is not TypeBox.) Tests that need a schema without TypeBox
already write plain JSON, such as `parameters: { type: "object", properties: {} }` in
`test/extensions.test.ts:423` [V].

Two observations:

- Phase 4 of the plan speaks of "the one `Type` import from `pi-ai`". There are two:
  `extensions/context-meter/server.test.ts:5` and `test/session-prompt.test.ts:12` [V]. The second
  cannot switch to `typebox` without declaring it in the root `package.json`, which does not [V].
  Plain JSON schemas, as in `test/extensions.test.ts`, avoid that.
- `server/` imports nothing from TypeBox, so the migration touches no core file [V].

Where `typebox` is declared [V: the `package.json` files]:

| `package.json`            | Field             | Version  |
| ------------------------- | ----------------- | -------- |
| `extensions/browser`      | `dependencies`    | `1.3.27` |
| `extensions/mcp`          | `dependencies`    | `1.3.27` |
| `extensions/subagents`    | `dependencies`    | `1.3.27` |
| `extensions/web-fetch`    | `dependencies`    | `1.3.27` |
| `extensions/web-search`   | `dependencies`    | `1.3.27` |
| `extensions/bash-timeout` | `devDependencies` | `1.3.27` |
| root `package.json`       | not declared      |          |

The lockfile has one `typebox@1.3.27` package (`pnpm-lock.yaml:3677`, `:7118`) and `typebox: 1.3.27`
under several entries [V]. Which of those are pi packages that still depend on it after 1.5 is [U];
`pnpm why typebox` answers it after the upgrade.

### Mapping

The TypeBox column is the output of `JSON.stringify` on `typebox` 1.3.27, run here [V]. The pi-schema
column was first what the README states; the migration then ran it, and the schema tests in the six
extensions are the check [V]. `obj` writes `required` after `properties` and `additionalProperties`
last, so key order differs from TypeBox; the tests compare parsed values, which ignores it.

| TypeBox (used)                                        | pi-schema 1.5.0                               | JSON the model receives                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Type.Object({...})`                                  | `obj({...}, { open: true })`                  | TypeBox is open: `{"type":"object","required":[...],"properties":{...}}`, no `additionalProperties` [V]. Plain `obj({...})` adds `additionalProperties: false` [V: README].           |
| `Type.Object({...}, { additionalProperties: false })` | `obj({...})`                                  | Same keyword [I].                                                                                                                                                                     |
| `Type.Object({})`                                     | `obj({}, { open: true })`                     | TypeBox: `{"type":"object","properties":{}}`, no `required` [V]. pi-schema: the same [V: run]. Unused in our tools.                                                                   |
| `Type.String({...})`                                  | `str({...})`                                  | `{"type":"string",...}` [V both].                                                                                                                                                     |
| `Type.Number`, `Type.Integer`                         | `num`, `int`                                  | `minimum` passes through [V: README option list].                                                                                                                                     |
| `Type.Boolean()`                                      | `bool()`                                      | `{"type":"boolean"}` [V: README].                                                                                                                                                     |
| `Type.Optional(x)`                                    | `opt(x)`                                      | The property leaves `required`. TypeBox: `"b":{"type":"integer","minimum":0}` with `b` absent from `required` [V]. The README example shows the same split [V].                       |
| `Type.Array(x, {...})`                                | `arr(x, { minItems, maxItems })`              | TypeBox: `{"type":"array","items":{...},"minItems":1,"maxItems":3}` [V]. `description` is accepted by every builder [V].                                                              |
| `Type.Unknown()`                                      | `unknown()`                                   | `{}` [V: README].                                                                                                                                                                     |
| `Type.Record(Type.String(), x, {...})`                | `map(x, {...})`                               | **Differs.** TypeBox: `{"type":"object","patternProperties":{"^.*$":{}}}` [V]. `map`: `{"type":"object","additionalProperties":x}` [V: README]. Same meaning [I], different JSON.     |
| `Type.Union(names.map(Type.Literal))`                 | `oneOf(ACTIONS)` or `union(ACTIONS.map(lit))` | **Differs.** TypeBox: `{"anyOf":[{"type":"string","const":"a"},...]}` [V]. `union(...lit)`: `anyOf` of `{"const":"a"}`, no `type` [V: README]. `oneOf`: `{"enum":[...]}` [V: README]. |

Three differences decided whether "the schema is unchanged" can hold:

1. **Openness.** Fixed with `{ open: true }`, which emits no `additionalProperties` at all, like
   `Type.Object` [V: run]. Plain `obj({...})` emits `additionalProperties: false`.
2. **`Record` to `map`.** Not fixable with the 1.5.0 builders. `unsafe<T>()` could wrap the raw schema,
   but it is Unreleased.
3. **`Literal`/`Union` to `lit`/`oneOf`.** Not fixable with the builders: `lit` drops the
   `type` keyword. Whether any provider needs `type` next to `const` is [U]. `oneOf` (`enum`) is the
   more widely supported form [I].

Decided: accept (2) and (3) as documented differences in the schema test, written in the same commit as
the switch. For (3) the builder closest to the old JSON is `union(ACTIONS.map((action) => lit(action)))`:
it keeps the `anyOf` and drops only each branch's `type: "string"`. `oneOf` would have turned the whole
thing into an `enum`. Neither writes `type`. pi-ai's Gemini conversion rewrites `const` as a one-value
`enum` [V: `pi-ai/dist/api/google-shared.js`], so the missing `type` is not known to break a provider;
no provider was called [U].

### Before and after

The smallest real tool schema is `agent_stop`, `extensions/subagents/server.ts:780` [V]:

```ts
parameters: Type.Object({ name: Type.String({ description: "Exact name of the agent." }) }),
```

The import today is `extensions/subagents/server.ts:31`: `import { Type } from "typebox";`.

Rewrite. **Unverified until compiled.**

```ts
import { obj, str } from "@earendil-works/pi-schema";

parameters: obj({ name: str({ description: "Exact name of the agent." }) }, { open: true }),
```

The TypeBox schema serialises to
`{"type":"object","required":["name"],"properties":{"name":{"type":"string","description":"Exact name of the agent."}}}`
(by the same construction as the printed cases [I]). The rewrite should give the same value; the schema
test below checks it.

## Part 2: Migration plan

**Prerequisite:** the pi 1.5 upgrade (Phase 4) is done. pi-durable 1.5.0 pins pi-schema 1.5.0 [V: its
`package.json`]. Add `@earendil-works/pi-schema` as a direct dependency,
pinned exactly (`1.5.0`, no caret), in the `dependencies` of each extension that imports it (the
`devDependencies` for a test-only import), where `typebox` was. **Not** a `peerDependencies` entry: the
host-peer test in `test/dependencies.test.ts` requires every peer to be declared by the root
`package.json` too, and the root imports no schema builder [V: read from the test]. The root declares it
only if root code or a root test imports it. `pnpm` links the one `pi-schema@1.5.0` that pi-durable
uses, so the schemas an extension builds and the validator that checks them share a copy. Reason for the
commit message: tools describe their parameters with the builder pi-durable 1.5 validates with, and it
replaces TypeBox.

One extension per step, smallest first, one commit each.

**The schema test, written first in every step that changes a model-visible tool.** Before editing the
extension, add a test that compares what the extension installs with the current TypeBox output,
written out as a literal. It pins the installed schema, not the provider payload: pi-ai converts the
schema per provider (Anthropic's non-strict path rebuilds the root and drops its
`additionalProperties`, Gemini turns `const` into a one-value `enum`, strict sampling closes every
object). Provider acceptance of the two changed schemas was checked live instead (see the plan, phase 5):

```ts
assert.deepEqual(schemasSent(webFetch(testHost())), EXPECTED); // keyed by tool name
```

`EXPECTED` is the JSON printed from the TypeBox schema before the switch. `JSON.parse(JSON.stringify())`
strips TypeBox's symbol keys. `deepStrictEqual` ignores object key order, so no key sorting is needed;
it does compare arrays such as `required` and `anyOf` in order [I]. The test passes on TypeBox, then
the code switches to pi-schema, then it must pass again. If it cannot, the edit to `EXPECTED` in the
commit is the explicit list of model-visible differences. The host argument is `testHost()` from `test/fixtures/host.ts`, and `schemasSent` from
`test/fixtures/tool-schemas.ts` does the `JSON.parse(JSON.stringify())` and keys the result by tool name.
Two factories do real work and the test must contain it: `mcp` starts the servers in Pi's `mcp.json`, so
its test points `PI_CODING_AGENT_DIR` and `dataDir` at an empty temporary folder and runs the disposers;
`browser` takes its `dataDir` from a temporary folder and stops through `hostOf`.

Every step ends with the extension's `server.test.ts`, `pnpm check`, `pnpm test`, and removing
`typebox` from that extension's `package.json` (then `pnpm install` to update the lockfile).

1. **Test-only schemas.** Files: `extensions/bash-timeout/server.test.ts`,
   `extensions/context-meter/server.test.ts`, `test/session-prompt.test.ts`, and the bash-timeout
   `package.json`. Replace the three `Type.Object` uses with `obj`/`str`, or plain JSON as in
   `test/extensions.test.ts:423`. If Phase 4 already did the two `pi-ai` imports, only bash-timeout is
   left. Check: the tests themselves. No schema test, since no model sees these schemas.
2. **`web-fetch`.** Files: `server.ts`, `package.json`. `Type.Object` to `obj(..., { open: true })`,
   `String` to `str`, `Integer` to `int`, `Optional` to `opt`; keep `minLength: 1` and `minimum: 0`.
   Check: schema test; `args.url` stays `string` and `args.offset` stays `number | undefined`
   (`tsc` through `pnpm check`).
3. **`mcp`.** Files: `server.ts`, `package.json`. As above, plus `Type.Record(...)` to `map(unknown(), ...)`. This is difference 2: `EXPECTED` changes from
   `patternProperties` to `additionalProperties: {}`, or the step is skipped. Check: schema test with
   that difference documented; `server.test.ts` still passes a call with `arguments`.
4. **`web-search`.** Files: `server.ts`, `package.json`. `Type.Array(x, {...})` to `arr(x, {...})`;
   keep `minLength`, `minItems`, `maxItems` (`MAX_QUERIES` and `20`). Check: schema test; `searchAnswer`
   still accepts `args`.
5. **`subagents`.** Files: `server.ts`, `package.json`. Four tools. `agent_spawn` has
   `additionalProperties: false` today: use `obj({...})` with no `open`. The other three are open:
   `{ open: true }`. Check: schema test for all four; `agent`, `task` required, `name`, `cwd` optional.
6. **`browser`.** Files: `server.ts`, `package.json`. Largest: 18 optional properties. `action` becomes
   `union(ACTIONS.map((action) => lit(action)))` (difference 3). Check: schema test with that
   difference documented; `const action: ToolAction = args.action` (`server.ts:48` defines
   `ToolAction`) must still compile [I], so run `pnpm check` before anything else.
7. **Remove `typebox`.** Files: every `package.json` that still lists it, `pnpm-lock.yaml`. Check:
   `grep -rn typebox --include=package.json . --exclude-dir=node_modules` and
   `grep typebox pnpm-lock.yaml` return nothing. If the lockfile still lists it, `pnpm why typebox`
   names the owner, and that is the end state, not a failure.

### Openness, per schema

`Type.Object` is open unless `additionalProperties: false` is given [V: printed]. A closed `obj` would
reject keys the model adds, as `invalid_arguments` [I]. Each step keeps today's openness:

| Tool                                            | Today  | After            |
| ----------------------------------------------- | ------ | ---------------- |
| `fetch_content`, `mcp`, `web_search`, `browser` | open   | `{ open: true }` |
| `agent_send`, `agent_stop`, `agent_status`      | open   | `{ open: true }` |
| `agent_spawn`                                   | closed | `obj({...})`     |
| test tools                                      | open   | `{ open: true }` |

[V: read from the code at the lines in the inventory.] Tightening an open schema is a behaviour
change and a separate decision.

## Not verified

- The upstream commits `fab2c53` and `6536f80`, the 7.9 MB figure, and "MCP tools use the same
  validator".
- The error-text change, `Type.Void`, `Format.Set` and `Refine` under 1.5. They are not in the
  pi-durable changelog; the pi-ai or pi-coding-agent changelogs were not read.
- That a model provider accepts `anyOf` of bare `const`s (`browser`'s `action`) and
  `additionalProperties: {}` (`mcp`'s `arguments`). No provider was called; the tests pin the JSON only.
