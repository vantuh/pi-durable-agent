# Extensions

Everything the app can do beyond the core is a folder in `extensions/`. The core knows no
extension by name; the loader only knows folders.

## The contract

```text
extensions/git-branch/
  server.ts       default export (host) => Extension | undefined; may export `status` and `actions`
  server.test.ts  its tests, run by `pnpm test`; never loaded
  refs.ts         action refs and types shared with `web.tsx`
  web.tsx         status items and settings sections (the browser loads it)
  sw.js           optional: plain script the build appends to the production service worker
```

Only `server.ts` is required for the server, and only `web.tsx` for the browser. `api.ts` (typed
dependencies between extensions) does not exist yet.

```ts
import { defineExtension } from "@earendil-works/pi-durable";

import type { Host } from "../../server/sdk.ts";

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
entries on every commit and returns one field, or nothing:

```ts
import type { StatusProvider } from "../../server/sdk.ts";

export const status: StatusProvider = ({ entries, contextWindow }) => ({
    text: "13 tok/s",
    title: "…",
});
```

The field may name a `slot`: `start`, `center`, or `end` (the default) of the status bar, for what is
about the app; `composer`, the line under the composer, for what one conversation used; or `title`,
in a small line under the conversation's title. It may also have a
`label`, and a `meter` (`fill` 0 to 1, `tone` `warn` or `danger`). `contextWindow(provider, model)` gives a
model's window from the catalog. Below `sm`, `end` fields are hidden and a `center` field loses its label.
`extensions/context-meter` draws its own `composer` item in `web.tsx` instead, because it opens a popup on hover; its server half serves the breakdown as an action and reads `host.contextWindow`.

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
import { ActionError, type Action } from "../../server/sdk.ts";

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

- **Status items** fill the same places (`start`, `center`, `end`, `composer`, `title`), before the fields that
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
  the server and a `title` status item: the branch, and the worktree's name when the folder is a
  linked worktree (its git dir is not the shared one).

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

### Tool icons

`web.tsx` may export `tools: [{ id, icon }]`: `id` is the name of a tool the folder registers,
`icon` a lucide icon. The transcript marks that tool's finished steps with it; a tool without one
gets a wrench. The core's own tools (`bash`, `read`, `edit`, …) keep the core's icons.

### Session menu items

`web.tsx` may export `sessionMenu: [{ id, label, icon, run }]`. Each item sits at the top of a
session row's menu, above Rename, Archive and Delete, with a separator. `run(sessionId)` is the
whole behaviour: the item's label is the toast while it runs, a rejection becomes a toast with its
message, and the list is re-read afterwards, so an item that names the session shows the new name
by itself. `extensions/auto-session-name` is the example.

## The host

`host` is what an extension knows about the process. It grows only when a feature needs more:

| Member                  | Is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | The folder's name; use it as the extension's name                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `cwd`                   | The folder the app was started in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dataDir`               | Where the app keeps its state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `log`                   | One line to the server's output                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `onDispose`             | Registers cleanup for the timers and subscriptions this version holds. It runs once: after a newer version is installed, when the folder is removed, or when the server stops. A disposer that throws is logged; the others still run                                                                                                                                                                                                                                                                                     |
| `onCommit`              | Registers a listener `(view: CommitView) => void \| Promise<void>` called after every commit of every conversation, with `{ session: { id, cwd, owner? }, entries, busy }`; `owner` is the id of the session that started this one (a task-owned conversation), absent for a session a person created. It is removed when this version is replaced, turned off or deleted; a throw is logged without data                                                                                                                 |
| `sessionRequest`        | `(session) => Promise<{ model, messages, send } \| undefined>`: the conversation's model, the messages its next request would send, and one request on top through the same model runtime, on the hour-long cache. `send(messages, signal, options?)` takes `{ systemPrompt, maxTokens, cacheRetention, sessionId, reasoning }` for a request of its own — the messages you pass are what is sent, not the conversation's. For work that reuses the cache and adds nothing to the transcript; see [Keep warm](#keep-warm) |
| `sessionTitle`          | `(session) => Promise<string \| null>`: the name the sidebar shows — the one set by hand from `app.title`, else the conversation's first question — or null while it has neither. Titles belong to the core, so an extension that names a conversation in its own UI asks instead of guessing                                                                                                                                                                                                                             |
| `sessionName`           | `(session) => Promise<string \| null>`: the name someone gave it, by hand or through an extension, without the first question the sidebar falls back to. This is the "is it named yet?" question; `sessionTitle` is the "what do I show?" one                                                                                                                                                                                                                                                                             |
| `setSessionTitle`       | `(session, title) => Promise<void>`: names the conversation for every browser, and an empty title goes back to the first question. The list is sent to the browsers at once, because a title is a document and no commit carries it                                                                                                                                                                                                                                                                                       |
| `readDoc`               | `(doc, session) => Promise<value>`: the current value of a conversation document, or its initial value while that conversation has none. It is for the places a tool call's `api.snapshot` does not reach, a commit listener and an action. The extension passes its own `defineDoc` token. It only reads: it creates no document and moves no revision                                                                                                                                                                   |
| `notifySessionChanged`  | `(session) => void`: says that something about the session changed which its own commits do not show, such as a conversation this extension started for it. Within 250 ms the server sends that session's `live` event again with a new `revision`, and a web component reads it as `session.revision` in `StatusProps`. Many calls in the window make one event                                                                                                                                                          |
| `registerModelProvider` | `(provider: Provider) => () => void`: puts a pi-ai provider in the catalog and in front of the model picker, and returns how to take it out. The registration goes with this extension version                                                                                                                                                                                                                                                                                                                            |

For `sessionRequest.send`, omitted `reasoning` inherits the session's thinking level; `"off"`
explicitly disables thinking for that request.

## Live, without a restart

The loader watches `extensions/` and reloads only the changed folders after 150 ms of quiet:

- **added** → installed, and the next request uses it;
- **changed** → the old one is replaced in place; a running tool call finishes on the old code;
- **broken** → the previous version stays installed, and the folder is listed as failed;
- **removed** → uninstalled, and its disposers run.

One thing does not reload: `host` itself. A member added to it in `server/` arrives with the process, so
an extension that calls one on the first live load fails with `host.sessionTitle is not a function`.
Restart the server after adding a member, before an extension uses it.

Connected conversation tabs show a toast after a live load, reload, removal or failure. A failure
says when the previous version is still active. Initial startup loads are silent; disabled folders
stay off. These notices report the server half, not whether the browser half finished its Vite HMR
update. Browser HMR is available in development only; production serves the last built UI.

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

## Subagents

`extensions/subagents` lets a conversation delegate work to agents in separate durable
conversations, following Pi Durable's background-task ownership pattern. Its complete usage and
maintenance guide lives with the feature: [Subagents README](../extensions/subagents/README.md).
Remaining proposals and historical verification notes are in its
[handoff](../extensions/subagents/HANDOFF.md).

- **Four tools:** `agent_spawn` starts a profile on a self-contained task; `agent_send` steers it or
  continues it with its own context; `agent_stop` aborts its current run; `agent_status` lists agents
  or shows one agent's working/idle state and a text preview. Names are local to the parent
  conversation. The browser facet gives all four tools bot icons.
- **Profiles:** Markdown with required `name`, `description`, and (at spawn) exact `model`, optional
  `tools` and `thinking`, and instructions in the body. Read from `<Pi agent directory>/agents/`
  (normally `~/.pi/agent/agents/`), then the nearest `.pi/agents/` above the session's cwd, overriding by name.
  Edits affect future spawns without a restart, not agents already started.
- **Profile-only model/thinking:** spawn accepts only `agent`, `task`, and optional `name`;
  model/thinking overrides are rejected. Missing, malformed, unavailable, or unauthenticated models
  return an error without creating an agent. Thinking must be supported by the profile's model;
  omission means `off`, invalid/unsupported values fail. No fallback, mapping, or silent clamping.
- **Inheritance:** a child starts with the parent's agent configuration, not its transcript; the
  profile supplies its model/thinking and applies instructions and optional tool restrictions.
  The subagents extension is removed from children, preventing recursive delegation. Children share the working directory and permissions; this is not a sandbox.
- **Reports:** background reporter tasks deliver answers automatically as steering input to the
  parent. `subagents.instruction` names `Orchestrator`; `subagents.report` names the child agent.
  Both use the generic [`data.author` convention](server.md#messages-from-application-authors) and
  link to the source conversation. Cards fold on screen, but the full report enters model context.
- **Stopping:** the parent's foreground Stop does not stop its background agents. `agent_stop`
  suppresses the unanswered result of a stopped run, keeps its context, and permits a later send.
  Direct input in the child creates no new reporter and therefore no automatic report to the parent.
- **Current limits:** reports have no length bound; child sessions are top-level list rows. There
  is no agent-count status item, full-result status parameter, model mapping, `ask_question` tool, or
  per-profile skill selection. See the local README before relying on stop/delete behavior.

## Planned, with where each comes from

| Folder  | What it is                                                | Source                              |
| ------- | --------------------------------------------------------- | ----------------------------------- |
| `files` | File browser in the drawer                                | Pi Pocket's file browser, rewritten |
| `web`   | The page the agent is working on, beside the conversation | Pi Pocket core, adapted             |

None of these exist yet. A folder is added when its feature is built, never as a placeholder.

## Adding one

1. Make the folder, write `server.ts`, export one extension named `host.name`.
2. Save. `GET /api/extensions` should list it.
3. Use it: the section, tool, or hook appears on the next request.
4. Put its tests in the folder, as `server.test.ts`. `pnpm test` runs `test/` and `extensions/`. The
   loader reads only `server.ts` and the browser only `web.tsx`, so a test file is never installed.

Deleting the folder is the whole removal, tests included.

## Not built

The browser has no panel or drawer that an extension can fill. Only status items and settings
sections exist. They wait for a real user: the
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

## Blocks above the composer

`web.tsx` may export `aboveComposer: [{ id, component }]`. The component renders between the
queued messages and the message box (top to bottom: transcript, queued messages, these blocks, the
box), inside its own error boundary, and follows the extension's enabled
switch. Its props are `StatusProps` plus `openSession(id)`, the app's own navigation, so a link
can open another session without a page load. A component that has nothing to show returns
`null` and takes no space. `extensions/subagents` uses it for the strip of working agents.

## Under the session list

`web.tsx` may export `sidebarBottom: [{ id, component }]`. The component renders in the sidebar
column under the session list, inside its own error boundary, and follows the extension's enabled
switch. Its props are `StatusProps` (`session`: the open session, or null on the home page) plus
`sessions` (every session, unfiltered: the list itself leaves out those started from another
session) and `openSession(id)`, the app's own navigation. On a phone it also closes the drawer.

- **The core owns the frame.** A drag handle sits between the list and the area
  (`role="separator"`). Drag it, or focus it and press `↑` / `↓` (16px; with Shift 64px), `Home` /
  `End` (the limits), `Enter` or double-click (back to fitting the content). The height is kept in
  `localStorage` (`sidebarBottomHeight`). Limits: the area keeps a minimum of about two rows and the list
  three rows (table below).
- **Hidden when empty.** If no item renders anything, the handle and the area are not drawn and
  take no space. A component with nothing to show returns `null`.
- **Sizing contract.** The area has a bounded height. Make the root
  `flex min-h-0 flex-1 flex-col`, keep a fixed heading, and put `overflow-y-auto` on the part that
  grows. Without a saved height the area fits its content, between the minimum and a cap of about
  six rows.
- **Hidden in the collapsed rail**; in the phone drawer it stays under the list.

| Size (px)            | From `lg` | Below `lg` |
| -------------------- | --------- | ---------- |
| Area minimum         | 96        | 120        |
| List minimum         | 148       | 160        |
| Handle height        | 10        | 16         |
| Area cap, no saved h | 224       | 296        |

The values come from the approved agents-area mockup (`docs/mockups/`); the arithmetic is
`web/src/lib/sidebar-bottom.ts`. `extensions/subagents` is meant to use this slot for the agents
of the open session.

## Composer items and Dictation

`web.tsx` may export `composer: [{ id, component }]`. The component renders in the composer's row,
before Send, inside its own error boundary, and follows the extension's enabled switch. Its
props are `StatusProps` plus `field` (a ref to the message box), `setText(value)` (replaces the
text as typing would, so the draft keeps it) and `onSent(listener)` (runs just before a message is
sent; returns the way to stop listening). The shell knows no feature by name.

`extensions/dictation` uses this slot for a mic, ported from Pi Pocket's `local-dictation`. The
browser records with `MediaRecorder`, resamples what it heard to 16 kHz mono 16-bit PCM and posts it
to this server's own routes, which transcribe it here with `transcribe-cpp` — a Handy whisper GGUF
on Metal. The Web Speech API is gone: no audio reaches a speech service, and dictating needs no
network. A browser without `MediaRecorder`, or a page off https or localhost, shows no mic.

- Three settings live in `dictation.json` in the data directory, and `details.tsx` — the Dictation
  row in the Extensions dialog, expanded — is the only way to change them: `language` (Auto, English
  or Ukrainian — `uk` stands in while the file does not exist yet, and `auto` passes no hint at all
  so the model detects it), `model` (null for the first Handy whisper GGUF found, else an absolute
  `.gguf` path) and `idleMinutes` (0 to 1440, default 10). No environment variables, and no settings
  section in the shell's panel. A file written before the model and the idle time were settings
  still reads, taking the defaults for the two it lacks.
- The model dropdown lists the whisper GGUFs under `~/.cache/huggingface/hub` with their names and
  sizes, the `large-v3-turbo` `Q8_0` first, and says so when there is none. The model holds ~900 MB
  with Metal, so it loads when a recording starts and goes after `idleMinutes` without a dictation;
  `0` lets it go as soon as the dictation that needed it ends. A failed load is tried again at the
  next one, and a chosen model whose file is gone says which path it wanted.
- The audio arrives in numbered parts of 300 000 bytes, joined back in number order and refused
  past 32 MB; the parts of a recording the browser never finished sending go after ten minutes,
  and anything under 0.35 s is a tap rather than a word.
- A short rising tone marks the start of a recording and a falling one its end (`beep.ts`, Web
  Audio; no files). The tone follows listening, not the text: transcription finishes later and says
  nothing.
- It never sends. Tap the mic again to stop, and the words go into the box at the caret, with a
  space only where words would touch and a capital on a sentence's first word (`insert.ts`, no
  React; its tests are plain strings). Leaving the page or turning the extension off drops a
  recording in flight.
- `server.ts` holds the model, the routes (`warm`, `audio`, `transcribe` under
  `/api/extensions/dictation/http/`) and the two actions behind the settings, `settings` and
  `saveSettings`, which validate every field with the rules the file is read with. `details.tsx`
  asks for them only while the folder is installed and on; off, it says so instead.

## Provider request shaping

The generic `host.shapeModelRequests(shape)` seam receives `(payload, model)` immediately
before transmission. Return a replacement or `undefined` to leave the payload untouched.
Registrations follow the extension's disposal lifecycle. The harness wraps both streaming
turns and non-streaming compaction requests, preserving any existing `onPayload` callback.
The core seam requires a server restart on first installation; subsequent extension changes
and toggles apply live to new requests.

## Kiro ACP models

`extensions/kiro-acp` adds the local `kiro-cli`'s models as provider `kiro-acp`, through
`@vantuh/pi-kiro-acp` from the checkout beside this one (`file:../pi-kiro-acp`). The dependency is
installed _injected_, so the package shares this app's `@earendil-works/pi-ai` instead of loading a
second copy; build it once there with `npm run build`, which is what writes the `dist/` the
`./provider` subpath points at. Pi keeps the conversation and the tools: Kiro sees the session's
tools over an in-process MCP server, and its own built-ins are refused at the permission gate.
`provider.close()` stops the `kiro-cli` processes it started, on reload, off, removal and shutdown.

Kiro signs in through `kiro-cli` itself, so there is no key to add. The model picker's `scoped` tab
lists only what `~/.pi/agent/settings.json` names in `enabledModels`; until `kiro-acp/<model>`
entries are added there, the Kiro models sit in `all`.

## Anthropic subscription request shaping

`extensions/anthropic-subscription` adds the Claude Code billing system block to native
Anthropic OAuth payloads, following Pi Pocket's `anthropic-subscription` feature and the
billing recipe in `@gotgenes/pi-anthropic-auth`. It does not launch Claude Code, rewrite
project prompts, suppress warnings, or guarantee subscription classification by Anthropic.
API-key payloads and other providers are left unchanged. Existing billing blocks are not duplicated;
messages, tools, and cache controls stay intact.

It is enabled by default, like other folders; turn **Anthropic subscription** off in the
Extensions dialog to send Pi's original payloads. The version defaults to `2.1.280` and can
be overridden with `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION=X.Y.Z` before starting the server.
A malformed override fails the extension load instead of silently sending a bad identity.

## Details in the Extensions dialog

An optional `extensions/<folder>/details.tsx` default-exports a plain function component
receiving `ExtensionDetailsProps` from the browser SDK: `{ enabled, installed }`.
Its presence makes the folder's title an expandable button in the Extensions dialog.
The switch remains separate; expanding does not enable the extension.

This facet is separate from `web.tsx`: it is lazy-loaded only when expanded, including
for disabled folders, without importing or mounting their normal browser features.
Keep its module top level side-effect-free. A loading or rendering failure is isolated
with an error boundary and an inline message. Like `web.tsx`, it uses Vite HMR.
Details may use the existing action API, but actions are unavailable when a folder is
not installed; the component must respect both props and show an honest offline state.
Polling and subscriptions must stop on collapse, disable or unmount. Tailwind scans
extension folders too, so their details components can use theme utilities.

Anthropic subscription details separate the selected billing version and its source from
**Sent billing version**, parsed from the outgoing billing block. Existing blocks remain
unchanged; an absent or unparseable version shows unavailable instead of the selected value.
The last-request fields describe only Anthropic POST messages requests across all sessions;
other providers and endpoints cannot overwrite them. Request fields are published as one
snapshot, and late responses/retries cannot replace a more recently started request's snapshot.
The learned floor is shared knowledge and may still be raised by an older request.
These in-memory diagnostics reset on extension reload/disable and retain no message text,
system prompt or token.
The open details refresh every three seconds, with no polling while disabled or collapsed.
A disabled folder shows only the bundled default, not a claim about the effective env override.
The displayed version is not the transport's HTTP User-Agent, and an applied shape does
not prove either a successful response or subscription billing.

### Resolved transport and OAuth detection

`host.wrapModelFetch((next, model) => fetch)` wraps the final model HTTP transport,
including its resolved authorization and User-Agent headers. Registrations follow the
same replacement/disposal lifecycle as payload shapers. Call the supplied `next` rather
than global fetch, preserving caller transports, signals and streaming responses.
Never log or retain credentials. Installing this new core capability requires a restart.

Anthropic subscription now checks the actual outgoing Bearer OAuth token on POST messages
requests instead of trusting a system-prompt identity marker. API keys and other providers
pass through untouched, even if their prompts contain a Claude Code identity. The helper
that builds the billing block assumes its caller has already checked OAuth authorization.

### Billing-version synchronization

For OAuth messages requests, the selected version is the numeric maximum of the bundled
version, the learned minimum and the final `claude-cli/X.Y.Z` User-Agent token. The token
may follow other whitespace-separated User-Agent tokens, but partial names and versions
with extra components or suffixes do not match. The HTTP User-Agent itself
is not rewritten. An explicit environment override is absolute, even when lower.
Details show both billing and observed Pi versions and distinguish a transport-derived
version. Unknown User-Agents fall back to the bundled version; no package registry or
local Claude installation is queried. Existing billing blocks are not replaced.

### Version rejection hints

Only a structured HTTP 400 with `error.details.error_code=claude_code_version_too_old`
is interpreted as a version rejection. A named required floor and recovery hint appear
in extension details and are appended to the original SDK error message. The error code,
status and request ID remain intact. Unknown wording produces a hint without inventing a
floor. Successful streams, other HTTP errors and non-JSON responses are not consumed or
rewritten. Diagnostic state keeps only the generated hint, floor and timestamp, not the
raw upstream error. Explicit version overrides get a specific explanation. If the actual
sent billing version already meets the required floor, the hint recommends updating Pi
rather than setting the billing version to the same value. Unparseable existing blocks
never result in a claim that their version met the floor.

### Bounded version recovery

A structured version rejection with a higher, explicitly named floor may replay the
request exactly once with a rebuilt billing block. Only blocks generated by this extension
are replayed; existing blocks, unknown floors, explicit overrides and aborted requests
are never retried. Network failures, successful responses and other HTTP errors get no
extension retry. The caller's transport and signal are used for both attempts.
The learned minimum is shared across this extension's requests in memory and discarded
on reload/disable. A second version rejection is surfaced with a hint, never chased.
Details show the learned minimum and whether the last OAuth request's retry recovered.

### On-demand account lookup

**Check subscription** in the extension details queries Anthropic's undocumented
`https://api.anthropic.com/api/oauth/profile` endpoint only when clicked. It shows the
organization/subscription type and status, seat/rate-limit tiers, and whether extra usage
is enabled. Missing or unfamiliar fields show Unknown. This does not report remaining
quota or prove which pool a model request was billed against.

Email and organization name are excluded from the server's result unless **Include email
and organization** is explicitly checked. Unchecking clears the displayed profile. Nothing
is persisted; there is no background profile polling. Lookup has a five-second timeout,
disallows redirects and returns sanitized failures rather than raw auth errors or bodies.
API-key or missing authorization causes no profile HTTP request. No model call is made.

The generic `host.resolveModelAuth(provider, signal)` capability resolves current request
authorization through ModelRuntime, including its normal refresh and credential locking.
It is server-only: credentials must never be returned to the browser, logged or cached by
extensions. The core supplies this because extensions must not read Pi's credential files
or implement OAuth refresh. Restart the server once to install this new capability.

## Raw HTTP and composer drafts

A server module may export `http: (host: Host) => HttpHandler`. Its factory runs after the default
export and returns a handler receiving `{ request, response, path }`, where `path` is relative to
`/api/extensions/:folder/http/` and includes the query string. Unlike JSON actions, it can stream
HTML, binary bodies and SSE. The handler owns ending the response and any upstream cleanup.
It follows reload/disable/removal and last-good-version rules just like actions. Core refuses
foreign-origin browser requests before dispatching it (and before extension actions).

Browser extensions may call `appendComposerDraft(sessionId, text, optionalUniqueId)` from
`@/sdk/composer.ts`. It appends without replacing existing input, updates a mounted composer, and
keeps inactive-session drafts separate. An optional ID deduplicates repeated delivery during the
page lifetime. It never submits a message. `extensions/git-history` uses both seams;
see [Git history and embedded review](git-history.md).

## Usage limits

`extensions/usage-limits` shows the five-hour limit of the current conversation's provider as a
meter in the `end` slot of the status bar (`5h ▮▮▯ 13%`, warn above 70%, danger above 90%). It
follows `session.model` (`provider/modelId`, in `StatusProps`), so a new session or a model change
shows the new provider's window. A click opens a popover above the button with every provider's
windows and reset times; the current provider is highlighted.

- Providers: Anthropic (OAuth only), OpenCode Go, OpenAI Codex, and Kiro. These are undocumented
  endpoints; a failing provider is an error row, never a crash.
- Anthropic and OpenCode Go tokens come from `host.resolveModelAuth` and never leave the server.
- Pi's OpenAI token is refused by the ChatGPT usage endpoint (HTTP 401), so Codex reads the Codex
  CLI's own sign-in from `$CODEX_HOME/auth.json` (`~/.codex/auth.json`). Without it Codex is absent.
- The browser reads every five minutes and when the popover opens (the refresh button does the same).
  A session switch only picks another row of the data already loaded. The server caches for four
  minutes and skips a forced read when the last one is under 30 s old. A provider that answers 429 is
  left alone for five minutes and keeps its last reading.
- Kiro's plan credits are not on the ACP wire, so `readKiro` parses `kiro-cli chat --no-interactive
  /usage` (a CLI format, not an API). Without `kiro-cli` the provider is absent. The credits bucket
  is the status bar's meter for `kiro-acp` models, labelled `Credits` instead of `5h`. It does not
  import `extensions/kiro-acp`.
- **Which providers.** The row in the Extensions dialog expands (`details.tsx`) to one switch per
  provider. The choice is stored in `usage-limits.json` in the data directory
  (`{ "hidden": ["codex"] }`; a missing or broken file shows all). A hidden provider is not asked at
  all and is not in the popover; if it is the current one, the status bar shows only the gauge icon.
  Changes apply at once.

## Keep warm

`extensions/keep-warm` renews the conversation's prompt cache while you are away, so your next
message reads the whole context at a tenth of the input price instead of writing it again. Ported
from Ultimate's `extensions/keep-warm`, with the harness seam below instead of theirs.

- **Why an hour.** Anthropic writes the prompt cache with `cache_control.ttl: "1h"` only when the
  request asks for it. The core opens the harness with `stream: { cacheRetention: "long" }`, so every
  request of every conversation asks; without it the cache dies after five minutes and no ping can
  renew it. A cache read costs 0.1× the input price and renews the hour, a write costs 1.25× (five
  minutes) or 2× (an hour), and only the new suffix is written.
- **When it pings.** A timer outside the task scheduler looks once a minute. A ping is due when the
  conversation's own last cache request is 55–60 minutes old, it has no run, it is on `anthropic`,
  and your latest input to it is under 8 hours old. A cache already past its hour is cold: a ping
  then would only pay to rebuild it.
- **What it sends.** The conversation's next context exactly as the harness would send it — pi-durable
  keeps the system sections and tool declarations inside the message stream — plus one user line
  asking for `ok`. Nothing is written to the transcript, and nothing is queued: the request goes
  straight through the model runtime, so `shapeModelRequests` and every installed fetch wrapper
  (`anthropic-subscription`) shape it like any other.
- **Never twice.** The attempt is stored as `interrupted` before the request is sent, so a crash
  mid-request counts as a failure; a failure blocks further pings until the conversation's next real
  request, so an outage or a rate limit is never retried in a loop. The switch, the conversations the
  user stopped and the last ping are in `keep-warm.json` in the data directory
  (`{ "off": true, "stop": { "3": 1793… }, "last": { "3": { … } } }`); the user's last input and the
  last cached answer come from the commits, and a restart recovers them from the baseline views the
  loader hands over.
- **What it costs.** A ping's tokens are not in `pi.usage`: they belong to no entry, so the
  conversation's spend does not include them. The popover shows what the last ping read and wrote.
- **The chip.** `warm` in the `end` slot: an ember flame (`--role-ember`, Catppuccin's peach) while
  it is on, dim while it is off. The popover has the switch, "Warm until 14:52" or "Cold since …",
  the next ping or why none is coming, and the last ping's read and write.
- **The switch is one for every conversation.** A ping is a spend, so the popover also lists what it
  is spent on: "Also warming", one row per other conversation with a ping coming, the most recently
  asked first, with the time of that ping. Rows come from the commits and the state file — the same
  data the tick reads — so the list never promises a ping the tick will not send. A conversation
  whose cache is already cold is not listed: it is not being warmed, and a ping would only pay to
  rebuild it. Each row is named through `sessionTitle`, so it says what the sidebar says, a rename
  included; when the core has no name yet — nothing asked, nothing written — the row falls back to
  the folder the conversation works in, and to nothing else. A conversation the core can no longer
  build a request for — deleted, unknown, or with no model chosen — is forgotten on the next tick,
  so the list stops promising a ping that cannot run.

The host members it uses are the two core seams: `sessionRequest(session)` answers the
conversation's model, the messages its next request would send, and `send(messages, signal, options?)`,
one request through the same model runtime; `sessionTitle(session)` answers the name the sidebar shows,
so a row in "Also warming" never has to re-derive it in the browser.
`busy` comes from `onCommit`, not from the seams.

## Session names

`extensions/auto-session-name` names a conversation from what it was about. Ported from the Pi
extension of the same name, which carries Pi Web's "generate name" policy: the whole conversation
under a character budget, the session's model, strict title parsing, and no fallback — a failed run
leaves the name alone instead of naming the session after a fragment of the user's own message.

- **The transcript.** `lib.ts` keeps the policy verbatim: 800 characters of each user turn, 300 of
  an intermediate reply and 600 of the newest, 6000 across the session with 40% reserved for the
  opening turns (a session states its goal early and then drifts into chores), tool calls and their
  results dropped, both ends kept and the middle elided. It reads the conversation's model context
  from `sessionRequest`, typed as pi-ai's `Message`: this copy has no branch for the roles only a Pi
  session record has (`bashExecution`, `compactionSummary`, `custom`), because a compaction reaches
  this app's model as the user message that carries its summary. That type is imported rather than
  restated, so a message shape that changes upstream breaks the file instead of passing silently.
- **The request.** The session's model at the cheapest thinking level it supports (Gemini's
  unsupported `minimal` skipped), 512 output tokens shared with the reasoning, no prompt cache or
  session id — too small to reuse a prefix or to warm one — and a 90-second abort. Its own system
  prompt, one user message, the harness's fetch wrappers shaping it like any other request.
- **Automatic, off by default.** `details.tsx` in the Extensions dialog turns it on; the setting is
  `auto-session-name.json` in the data directory. Then a run that ends names its session **only while
  the session has no name** — `sessionName`, not `sessionTitle`, because the first question is not a
  name. A name set by hand is never replaced, and neither is one this extension set, so it happens
  once per session. A failed call changes nothing and the next settle tries again.
- **The menu item.** "Generate name" in a session row's menu is the explicit path, and the only one
  that replaces a name: it keeps a name that landed while the title was generating, and says so.
- **What it names.** The title lands in `app.title` through `setSessionTitle`, so the sidebar, the
  header and every extension that asks `sessionTitle` see it. Clearing the name by hand returns the
  session to its first question, and turns automatic naming on for it again.

## MCP servers

`extensions/mcp` reads the servers from Pi's own `mcp.json` (`<agent dir>/mcp.json`, so profiles
work) and connects to them with `@earendil-works/pi-mcp`. Settings lists them, each with a switch.

- A server is `command` + `args` + `env` (stdio) or `url` + `headers` (Streamable HTTP). An `env` or
  `headers` value starting with `!` is a shell command whose output is the value, as in Pi's other
  files. `enabled: false` is the default for a server; the switch overrides it.
- The switch is stored in `enabled.json` under the data directory's `mcp/`. `mcp.json` is never
  written: Pi's CLI reads it too.
- Servers that are on connect when the extension installs, in the background; a failure shows as
  the server's status. Turning an extension off, reloading it or stopping the server closes them.
- Pi gets one tool, `mcp`: no arguments lists the servers, `server` shows its tools with their input
  schemas, `server` + `tool` + `arguments` calls one. A server's tools are not registered one by one:
  there can be dozens, and the tool set of an extension is fixed when it is installed.
- The list shows a stdio server's `command` only, never its arguments, environment or headers.
- Not built: OAuth (`mcp-auth.json`), a project's own `.pi/mcp.json`, reading the file again while
  a server is connected (turn it off and on), `exposure`, resources and prompts.
