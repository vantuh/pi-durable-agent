# Extensions

Everything the app can do beyond the core is a folder in `extensions/`. The core knows no
extension by name; the loader only knows folders.

## The contract

```text
extensions/prompt/
  server.ts    default export (host) => Extension | undefined
```

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

| Rule                                       | Why                                                               |
| ------------------------------------------ | ----------------------------------------------------------------- |
| The extension's name is the folder's       | Reloading replaces by name; a name that drifts installs twice     |
| `coding-tools` is reserved                 | The core's tools are installed there; a folder would replace them |
| A folder without `server.ts` is skipped    | Web-only folders are legal later; they are not extensions yet     |
| Names starting with `_` or `.` are skipped | A place to park a folder under construction                       |
| A failed folder keeps its last version     | A typo must not take a working feature away                       |

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

The field may name a `slot` (`start`: after folder and branch, `center`, or `end`, the default), a
`label`, and a `meter` (`fill` 0 to 1, `tone` `warn` or `danger`). `contextWindow(provider, model)` gives a
model's window from the catalog. Below `sm`, `end` fields are hidden and a `center` field loses its label.
`extensions/context-meter` is the example for `center` with a meter.

The field travels in `live.status` of the event stream, keyed by the folder's name. The core knows no
field by name: install the folder and it appears, remove the folder and the next event drops it.
`extensions/tokens-per-second` is the example. A folder that only adds a field still returns
`defineExtension({ name: host.name })`, so it is listed as installed.

## Actions

A folder may export `actions` next to its default export: a plain object of functions. The browser
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

## The host

`host` is what an extension knows about the process. It grows only when a feature needs more:

| Member      | Is                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | The folder's name; use it as the extension's name                                                                                                                                                                                     |
| `cwd`       | The folder the app was started in                                                                                                                                                                                                     |
| `dataDir`   | Where the app keeps its state                                                                                                                                                                                                         |
| `log`       | One line to the server's output                                                                                                                                                                                                       |
| `onDispose` | Registers cleanup for the timers and subscriptions this version holds. It runs once: after a newer version is installed, when the folder is removed, or when the server stops. A disposer that throws is logged; the others still run |

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
{"installed":["prompt"],"failed":[]}
```

A failure looks like this, and the server keeps serving:

```json
{
    "installed": ["prompt"],
    "failed": [{ "folder": "probe", "reason": "server.ts has no default function export" }]
}
```

A reload imports `server.ts` again under a new `?v=` URL. A resolve hook gives the same query to every
file that `server.ts` imports from inside its own folder, also in subfolders, so a changed helper runs
its new code. Packages, `node_modules`, and files outside the folder (such as `server/extensions.ts`)
get no query and stay single instances. Each reload keeps the old module graph (`server.ts` and its
helpers) in memory until the process restarts. A module's top-level state is not kept across a reload. Keep
state in documents or in `data/`, never in a module. Cleanup goes in `host.onDispose`.

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

Deleting the folder is the whole removal.
