# Extensions

Everything the app can do beyond the core is a folder in `extensions/`. The core knows no
extension by name; the loader only knows folders.

## The contract

```text
extensions/git-branch/
  server.ts       default export (host) => Extension | undefined; may export `status` and `actions`
  server.test.ts  its tests, run by `pnpm test`; never loaded
  refs.ts         action refs and types shared with `web.tsx`
  web.tsx         status-bar items and settings sections (the browser loads it)
  sw.js           optional: plain script the build appends to the production service worker
```

Only `server.ts` is required for the server, and only `web.tsx` for the browser. `api.ts` (typed
dependencies between extensions) does not exist yet.

```ts
import { defineExtension } from "@earendil-works/pi-durable";

import type { Host } from "../../server/extensions.ts";

export default function prompt(host: Host) {
    return defineExtension({
        name: host.name, // always the folder's name
        sections: [/* prompt sections */],
        tools: [/* tools */],
        hooks: [/* checks and changes on tool calls */],
    });
}
```

Rules the loader enforces, and why:

| Rule                                       | Why                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| The extension's name is the folder's       | Reloading replaces by name; a name that drifts installs twice                                                         |
| `coding-tools` is reserved                 | The core's tools are installed there; a folder would replace them                                                     |
| A folder without `server.ts` is skipped    | The server installs nothing for it, and `GET /api/extensions` does not list it. The browser still loads its `web.tsx` |
| Names starting with `_` or `.` are skipped | A place to park a folder under construction                                                                           |
| A failed folder keeps its last version     | A typo must not take a working feature away                                                                           |

## Name, description, on and off

A folder may export `meta` next to its default export. The owner sees it in the list of extensions:

```ts
export const meta = {
    title: "Cache hit",
    description: "Shows how much input came from the cache.",
};
```

- Both fields must be non-empty strings. Otherwise the folder fails with a reason that names `meta`.
- Without `meta` the title is the folder's name and the description is empty.
- The owner can turn each folder on or off. The choice is stored on the server in
  `extensions.json` in the data directory: `{ "disabled": ["folder"] }`. A missing or broken file
  means every folder is on.
- A disabled folder is not installed: its default export is not called, and it has no actions or
  status field. Turning a folder off drops the installed version and runs its disposers. Turning it
  on installs it again. Both work live, with no restart.
- To show the title of a disabled folder, the loader still imports `server.ts` to read `meta`. So the
  module's top level must have no side effects: no timers, no subscriptions, no file writes. Start
  those in the default export and register their cleanup with `host.onDispose`.
- **The modal:** the Settings panel has a footer with a puzzle icon ("Extensions"). It opens a modal
  with one row per folder: title, description, an error if there is one, and a switch. A switch
  calls `PUT /api/extensions/:name`; if the server refuses, the switch goes back and the error shows
  in the row.
- **The browser half follows the switch.** `web/src/extensions.ts` reads `GET /api/extensions` at
  start and after each toggle. It imports the `web.tsx` of a folder only when the folder is on, and
  only once. Status items and settings sections of a folder that is off go away at once, with no
  page reload. A folder the server does not list (web code only) stays on.
- `PUT /api/extensions/:name` with `{ "enabled": boolean }` changes the choice
  ([server.md](server.md)).

## Status fields

A folder may also export `status` next to its default export. It receives the conversation's active
entries on every commit and returns one field for the status bar, or nothing:

```ts
import type { StatusProvider } from "../../server/extensions.ts";

export const status: StatusProvider = ({ entries, contextWindow }) => ({
    text: "13 tok/s",
    title: "…",
});
```

The field may name a `slot` (`start`: after the folder, `center`, or `end`, the default), a
`label`, and a `meter` (`fill` 0 to 1, `tone` `warn` or `danger`). `contextWindow(provider, model)` gives a
model's window from the catalog. Below `sm`, `end` fields are hidden and a `center` field loses its label.
`extensions/context-meter` is the example for `center` with a meter.

The field travels in `live.status` of the event stream, keyed by the folder's name. The core knows no
field by name: install the folder and it appears, remove the folder and the next event drops it.
`extensions/tokens-per-second` is the example. A folder that only adds a field still returns
`defineExtension({ name: host.name })`, so it is listed as installed.

## Actions

A folder may export `actions` next to its default export: a plain object of functions, or a function
`(host) => Record<string, Action>` when the actions need the host (for example `host.dataDir`) and the
module must keep no state. The function runs when the version is built: if it throws, the build fails
and the old version stays. The browser
calls one through the single route `POST /api/extensions/:extension/actions/:action`, so a new
action needs no new route in the core.

```ts
import { ActionError, type Action } from "../../server/extensions.ts";

export const actions: Record<string, Action> = {
    rename({ args, session }) {
        if (typeof args !== "string") {
            throw new ActionError("args must be a string"); // 400
        }

        return { renamed: args, cwd: session?.cwd ?? null }; // 200 { result }
    },
};
```

- The call is `{ args, session }`. `args` is unchecked JSON: the action validates it. `session` is
  `{ id, cwd }` when the request named one, else `null`.
- `ActionError` answers 400 with its message. Any other throw answers 500 with its message.
- An unknown extension, action, or session answers 404.
- The result must be JSON-serialisable. The action decides what it returns; nothing else is exposed.
- Actions follow the installed version: a failed replacement keeps the old actions, and a removed
  folder, or one that installs nothing, drops them. A bad `actions` export (not a plain object, or a
  value that is not a function) fails the build with that reason.

## The browser half

A folder may also hold `web.tsx`. Vite bundles every `extensions/*/web.tsx` (a folder name starting
with `_` or `.` is skipped) as a lazy module, and the core reads the folder name from the path. The default export is a
`WebExtension` (`web/src/sdk/types.ts`):

```tsx
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

function Item({ session }: StatusProps) {
    return <span className="text-faint font-mono">{session?.cwd}</span>;
}

export default { status: [{ id: "cwd", slot: "start", component: Item }] } satisfies WebExtension;
```

- **Status items** fill the status bar's `start`, `center`, or `end` slot, before the fields that
  `status` providers send. `session` is `{ id, cwd, busy }`, or `null` before one is open. The item
  draws its own markup (`hidden sm:flex` and so on) and uses theme roles for colour.
- `component` must be a plain function component; a `memo` or `forwardRef` object is rejected.
- Modules load after the first render, each on its own: the app renders while they load. A module that
  throws at top level, fails to import, or has a bad shape is skipped with a `console.error` that
  names the folder; the others still load. A second item with the same `id` in one folder is skipped
  the same way. Each item sits in an error boundary: an item that throws while rendering hides only
  itself and logs once.
- **Calling the server half:** `callAction(ref, args, sessionId)` from `@/sdk/actions.ts` posts to
  the action route. A non-OK answer throws an `Error` with the server's message. `ref` comes from
  `actionRef<Args, Result>(extension, name, parse)` in `shared/extension-api.ts`; put it in a browser-safe
  `refs.ts` in the folder. `parse(value: unknown): Result` returns the result or throws; `callAction`
  returns what it returns, and a throw becomes the error of the call. The server never uses the ref.
- **Settings sections** (`settings: [{ id, title, component }]`) are drawn in the Settings panel after
  the core sections, under an `h3` with the title. They get the same `session` as status items. Each
  sits in an error boundary; the loading, skipping, duplicate-`id` and function-component rules are
  those of status items.
- **An extension owns its settings:** its defaults, validation, storage and the effect of a change.
  The core only draws the section. Store the value through the folder's own actions (a broken or
  missing file gives the defaults), validate `args` there, and apply the change in the browser at once
  (a small store in `web.tsx` can share it between an item and a section).
- `extensions/push` is an example of a settings section with buttons, actions and a commit
  listener ([push.md](push.md)). `extensions/git-branch` is an example of a `branch` action on
  the server and a `start` status item.

### The service worker facet

A folder may hold `sw.js`: a plain script with no imports. The build appends it, wrapped in an
IIFE, to the production worker, so a feature can handle `push` or `notificationclick` without a
change to `web/sw.js`. It does not run in `pnpm dev` (no worker is registered there), and it is
never turned off with the folder's switch: the worker is built from the files present. Check any
data it receives, because it runs outside the page.

### Panels

`web.tsx` may also export `panels: [{ id, title, icon, component }]`. Each adds a button to the
conversation header; the open panel sits to the right of the transcript (a full-screen overlay
below `lg`). The component gets `{ session, onClose }`. `extensions/browser` is the example: its
frames travel as base64 through an action that waits for the next one, as extensions have no
routes of their own.

## The host

`host` is what an extension knows about the process. It grows only when a feature needs more:

| Member      | Is                                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | The folder's name; use it as the extension's name                                                                                                                                                                                                                      |
| `cwd`       | The folder the app was started in                                                                                                                                                                                                                                      |
| `dataDir`   | Where the app keeps its state                                                                                                                                                                                                                                          |
| `log`       | One line to the server's output                                                                                                                                                                                                                                        |
| `onDispose` | Registers cleanup for the timers and subscriptions this version holds. It runs once: after a newer version is installed, when the folder is removed, or when the server stops. A disposer that throws is logged; the others still run                                  |
| `onCommit`  | Registers a listener `(view: CommitView) => void \| Promise<void>` called after every commit of every conversation, with `{ session: { id, cwd }, entries, busy }`. It is removed when this version is replaced, turned off or deleted; a throw is logged without data |

## Live, without a restart

The loader watches `extensions/` and reloads on a change, at most once per 150 ms of quiet:

- **added** → installed, and the next request uses it;
- **changed** → the old one is replaced in place; a running tool call finishes on the old code;
- **broken** → the previous version stays installed, and the folder is listed as failed;
- **removed** → uninstalled, and its disposers run.

Disposers follow the version that registered them:

- **Replaced:** the new version is built first. If it builds, it is installed, then the old
  version's disposers run. If the build fails (throw, wrong name, bad export), the disposers that
  the failed attempt registered run, and the old version keeps its own.
- **Installs nothing** (the default export returns `undefined`): the old version is uninstalled and
  its disposers run. The disposers of the new run are kept, not run: the module did run and holds
  what it registered, so they run on the next reload, removal, or stop.
- **Stop:** `Extensions.dispose()` stops the watcher and runs every disposer. `server/main.ts` calls
  it on SIGINT and SIGTERM.

```bash
curl -s http://127.0.0.1:8788/api/extensions
{"installed":["cache-hit","prompt"],"failed":[],"extensions":[{"name":"cache-hit","title":"Cache hit","description":"…","enabled":true,"installed":true}, …]}
```

A failure looks like this, and the server keeps serving. `extensions` has an `error` on that folder:

```json
{
    "installed": ["cache-hit", "prompt"],
    "failed": [{ "folder": "probe", "reason": "server.ts has no default function export" }],
    "extensions": [
        {
            "name": "probe",
            "title": "probe",
            "description": "",
            "enabled": true,
            "installed": false,
            "error": "server.ts has no default function export"
        }
    ]
}
```

A reload imports `server.ts` again under a new `?v=` URL. A resolve hook gives the same query to every
file that `server.ts` imports from inside its own folder, also in subfolders, so a changed helper runs
its new code. Packages, `node_modules`, and files outside the folder (such as `server/extensions.ts`)
get no query and stay single instances. Each reload keeps the old module graph (`server.ts` and its
helpers) in memory until the process restarts. A module's top-level state is not kept across a reload. Keep
state in documents or in `data/`, never in a module. Cleanup goes in `host.onDispose`.

`web.tsx` goes live through Vite HMR. Vite's root is `web/`, so `vite.config.ts` adds `extensions/`
to the watcher. What happens in `pnpm dev`:

- **file changed** → a live update: Vite re-imports the module and the item list is read again,
  without a page reload;
- **syntax error** → the same update; the browser then gets the transform error, until the file
  is fixed;
- **file removed** (any file under `extensions/` that the page loaded, or the whole folder) → a full page reload. A live
  update does not work here: Vite sends an update for the deleted module, the browser gets a 404 for
  it (`Failed to reload`), and the item list is not rebuilt. `vite.config.ts` therefore drops the
  update and reloads the page;
- **folder added** → a live update: `web/src/extensions.ts` lists the new `web.tsx` without a
  restart. Without the watcher entry a new folder was not seen.

## What an extension may not do

- Import another extension's files. Later this goes through `api.ts` and `host.need` / `host.want`.
- Read or write the core's SQLite directly.
- Add a name to `RESERVED`.

## Planned, with where each comes from

| Folder      | What it is                                                                         | Source                                  |
| ----------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| `files`     | File browser in the drawer                                                         | Pi Pocket's file browser, rewritten     |
| `web`       | The page the agent is working on, beside the conversation                          | Pi Pocket core, adapted                 |
| `subagents` | Agents the conversation can hand work to, and the `agents` count in the status bar | Ultimate, rewritten                     |
| `dictation` | Local speech to text in the composer                                               | Pi Pocket's dictation extension, ported |
| `warm`      | The session warm-up toggle from Ultimate's drawer                                  | Ultimate, rewritten                     |

None of these exist yet. A folder is added when its feature is built, never as a placeholder.

## Adding one

1. Make the folder, write `server.ts`, export one extension named `host.name`.
2. Save. `GET /api/extensions` should list it.
3. Use it: the section, tool, or hook appears on the next request.
4. Put its tests in the folder, as `server.test.ts`. `pnpm test` runs `test/` and `extensions/`. The
   loader reads only `server.ts` and the browser only `web.tsx`, so a test file is never installed.

Deleting the folder is the whole removal, tests included.

## Not built

The browser has no panel or drawer that an extension can fill, and no composer action that an
extension can add. Only status items and settings sections exist. They wait for a real user: the
first extension that needs one (such as `files`) defines it.

## Header items and Git statistics

`web.tsx` may export `header: [{ id, component }]`. A header item gets the same `StatusProps`
as a status item, renders before the panel buttons, follows the extension's enabled switch and
has its own error boundary. The shell knows no feature by name.

`extensions/git-stats` uses this slot for a rounded `+added −deleted ↑ahead ↓behind` badge:

- Line counts compare the whole working tree with HEAD (staged and unstaged combined), including
  untracked, non-ignored files. A replaced line contributes one deletion and one addition; Git does
  not report a separate “modified lines” count. Binary files contribute no line counts.
- An initial branch without commits is supported. Outside a working-tree repository, it draws nothing.
- Commit counts compare against the configured upstream as of the **last fetch**. The extension
  does not fetch or pull automatically. Without an upstream, the counters show `?` and Push is disabled.
- Counts refresh every ten seconds, after agent activity and after a push.
- Push asks for confirmation, rechecks the branch on the server and sends only HEAD to that branch's
  configured upstream. No force, tag following or recursive submodule pushes. No automatic commit,
  upstream creation or pull/rebase. A behind/diverged branch must be reconciled in Git first.
- Push has a 60-second timeout and disables terminal credential prompts; configure Git credentials
  beforehand. Failures are shown in the header popover and can be dismissed.
