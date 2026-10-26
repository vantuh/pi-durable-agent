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

## The host

`host` is what an extension knows about the process. It grows only when a feature needs more:

| Member    | Is                                                |
| --------- | ------------------------------------------------- |
| `name`    | The folder's name; use it as the extension's name |
| `cwd`     | The folder the app was started in                 |
| `dataDir` | Where the app keeps its state                     |
| `log`     | One line to the server's output                   |

## Live, without a restart

The loader watches `extensions/` and reloads on a change, at most once per 150 ms of quiet:

- **added** → installed, and the next request uses it;
- **changed** → the old one is replaced in place; a running tool call finishes on the old code;
- **broken** → the previous version stays installed, and the folder is listed as failed;
- **removed** → uninstalled.

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

A reload imports the folder again under a new URL, so a module's top-level state is not kept. Keep
state in documents or in `data/`, never in a module.

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
