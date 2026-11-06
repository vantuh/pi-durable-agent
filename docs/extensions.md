# Extensions

Everything the app can do beyond the core is a folder in `extensions/`. The core knows no
extension by name; the loader only knows folders.

## The contract

Only `server.ts` is required for the server, and only `web.tsx` for the browser. `api.ts` (typed
dependencies between extensions) does not exist yet. The files an extension may have, and where they
go, are in [The layout](#the-layout) below.

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
| A tool or section name has one owner       | The harness keeps the last one silently; an extension that changes another's uses `wraps`                             |
| A folder without `server.ts` is skipped    | The server installs nothing for it, and `GET /api/extensions` does not list it. The browser still loads its `web.tsx` |
| Names starting with `_` or `.` are skipped | A place to park a folder under construction                                                                           |
| A failed folder keeps its last version     | A typo must not take a working feature away                                                                           |

## The layout

Every extension has the same shape, so a reader knows where a file is before opening the folder.

```text
extensions/<name>/
  package.json     name `@pi-durable-agent/<name>` and the extension's own dependencies
  README.md        usage, configuration, behaviour and limits; every extension has one
  server.ts        entry, found by the server loader by name
  server.test.ts   tests of what server.ts installs
  web.tsx          entry, found by the browser glob by name
  details.tsx      entry, found by the Extensions dialog glob by name
  refs.ts          the contract between the halves: action refs, shared types, parsers;
                   browser-safe, no Node imports
  server/          server-only code server.ts imports; Node APIs allowed; tests beside the file
  web/             browser-only code web.tsx and details.tsx import: one exported component per
                   file, hooks in use-*.ts, browser helpers; tests beside the file
  assets/          fonts, icons, scripts and other files read by path (`sw.js` is one)
  fixtures/        test data
  LICENSE.*        notices for copied code, kept beside the code they cover
```

Rules:

- **The top level holds only the names above.** Every other file goes into `server/` or `web/`. The
  three entries are found by name, so they cannot move; everything else can, and putting it in a
  folder named after its runtime keeps it there. `test/extension-layout.test.ts` fails when a file
  outside the list appears.
- **The folder says where the code runs.** `server/` may import Node; `web/` is bundled by Vite and
  must not; `refs.ts` is imported by both. A Node import reaching the browser bundle is the mistake
  this prevents, and it is the one Vite reports late.
- **Entries only wire.** `server.ts` builds the tools, prompt sections, hooks and actions from
  `server/`; `web.tsx` and `details.tsx` register components from `web/`. Logic lives in the folders.
- **Optional parts stay absent.** A server-only extension has no `web.tsx` and no `web/`; an empty
  folder is never created.
- **Shared code is `refs.ts`.** If it outgrows ~300 lines it becomes a `shared/` folder, imported by
  both halves; not before.
- **Reload follows the folder.** A change in `server.ts`, `refs.ts` or under `server/` reinstalls the
  extension. A change under `web/`, `assets/` or `fixtures/`, in `web.tsx`, `details.tsx`, a test or a
  Markdown file does not. Helper imports inside the folder carry the entry's version, so the
  reinstalled extension runs the edited `server/*.ts`.
- **The core's server code comes from `sdk.ts` only.** An entry imports `../../server/sdk.ts`; a file in
  the extension's own `server/` imports `../../../server/sdk.ts`. Its own `server/` folder is imported as
  `./server/` or `../server/` (oxlint tells the two apart).

## Package dependencies

The root package describes the core and its shared build/check tools. Each extension declares its
own external imports in a private `package.json` with `"type": "module"`. A package used only by
extensions belongs in their `dependencies`, even when several extensions use it. Test-only packages
and package-specific type declarations belong in the consuming package's `devDependencies`.

React, React DOM, Lucide and the Pi host packages already used by the core are shared through
`peerDependencies`. Extensions use the core's UI components directly; they do not install another
UI stack. A direct package import must be declared even when a transitive dependency already
installs that package. The root may also declare an extension's runtime dependency as a dev
dependency when core tests need it, such as `linkedom`.

`extensions/*` are pnpm workspace packages with one root `pnpm-lock.yaml`. Run `pnpm install` from
the root to install the whole application, including extensions; `pnpm check`, `pnpm test` and
`pnpm build` still cover the whole checkout. To add an extension's own dependency, use
`pnpm --filter @pi-durable-agent/<folder> add <package>` and commit the shared lockfile with its
manifest. Keep `@earendil-works/*` versions pinned exactly.

This records dependency ownership, not isolation or optional installation. Node can still resolve
packages from ancestor `node_modules` directories, and disabled extensions still need their
packages for the full check and build. Package updates require an install and a server restart;
source hot reload does not reload package instances.

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
`extensions/context-meter` draws its own `composer` item in `web.tsx` instead, because it opens a popover on click; its server half serves the breakdown as an action, reading `host.contextWindow` and, before a session's first request, `host.sessionPrompt`.

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
  draws its own markup (`hidden sm:flex` and so on) and uses theme roles for colour. It also gets
  `sessions`: every session, unfiltered (the sidebar leaves out those started from another
  session, the item does not). That is how an item counts something across sessions, such as the
  working agents of every parent, in the `start`, `center` or `end` slot of the status bar.
- `component` must be a plain function component; a `memo` or `forwardRef` object is rejected.
- `order` places an item among the others of its slot: lower first, unset is `0`, and the folder
  still decides among equals. `extensions/caveman` and `extensions/ponytail` both set `-1`, so their
  two chips open the bar's `end` items, in folder order: caveman, then ponytail, then keep-warm's.
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
- **A per-session on/off switch:** `useBooleanAction(sessionId, state, set)` from
  `@/sdk/boolean-action.ts` keeps one for a status item: `state` and `set` are action refs that answer
  `{ on: boolean }`. It returns `{ mode, read, toggle }`: `mode` is null until the server has answered,
  `read()` rereads (a popover opening), `toggle(on)` saves and then settles on what the server stored.
  It drops an answer that a newer reading or a save has overtaken, and tries an unreachable server
  three times, five seconds apart. `caveman` and `ponytail` are two uses of it.
- **Settings sections** (`settings: [{ id, title, component }]`) are drawn in the Settings panel after
  the core sections, under an `h3` with the title. They get the same `session` as status items. Each
  sits in an error boundary; the loading, skipping, duplicate-`id` and function-component rules are
  those of status items.
- **An extension owns its settings:** its defaults, validation, storage and the effect of a change.
  The core only draws the section. Store the value through the folder's own actions (a broken or
  missing file gives the defaults), validate `args` there, and apply the change in the browser at once
  (a small store in `web.tsx` can share it between an item and a section).
- `extensions/push` is an example of a settings section with buttons, actions and a commit
  listener ([Push notifications](../extensions/push/README.md)). `extensions/git-branch` is an example
  of a `branch` action on the server and a `title` status item: the branch of the session's folder. `extensions/git-worktree`
  shows the worktree beside it, and the button that removes one.

### The service worker facet

A folder may hold `assets/sw.js`: a plain script with no imports. The build appends it, wrapped in an
IIFE, to the production worker, so a feature can handle `push` or `notificationclick` without a
change to `web/sw.js`. It does not run in `pnpm dev` (no worker is registered there), and it is
never turned off with the folder's switch: the worker is built from the files present. Check any
data it receives, because it runs outside the page.

### Panels

`web.tsx` may also export `panels: [{ id, title, icon, component }]`. Each adds a tab to the
right sidebar, opened by the one "Extensions" button in the conversation header; the open panel sits
to the right of the transcript (a full-screen overlay below `lg`). The button remembers the panel
opened last, per session, and brings it back. The component gets `{ session, onClose, expanded, setExpanded }`: a panel that draws its
own control may ask to fill the conversation instead of the drawer, and the shell places it there
(the same frame and box an extension's page takes) with the transcript and composer hidden and inert
under it. The body stays mounted across the toggle, so a live view inside it keeps its state; Escape,
closing the panel and changing session all return it to the drawer. The core draws no expand button of
its own: a panel that does not ask never expands. `extensions/browser` is the example: its
frames travel as base64 through an action that waits for the next one, as extensions have no
routes of their own. A panel may add `badge`, a component that gets `StatusProps` and returns a
number (or text) for a small count on its tab, or `null` for none; the core draws
the pill and hides it when the component returns nothing. `extensions/notes` is the example.

### Pages

`web.tsx` may also export `pages: [{ id, title, icon, component, badge? }]`. Each adds a tab beside the panels' in the right sidebar; it opens the page in place of the
conversation — the transcript and composer make way for a frame with the same tab strip (the page's
tab active) and a close button; a sub-location adds a back arrow to its parent. The page's body fills
the rest. The right sidebar is closed while a page is open; the left sidebar and the status bar stay
as they are. The transcript and composer stay mounted out of sight, so a draft, a scroll
position and a running answer survive the visit.

- **The address carries it**: `/?session=N&page=<folder>:<id>&sub=<sub>`. Opening a page adds a
  history step, so browser Back and the phone's back gesture return to the conversation. The page's
  own `navigate(sub)` adds a step the same way, so Back walks its sub-locations. Session links
  (`/?session=N`, the sidebar, Home) drop the page; a deep link opens it directly.
- **The component** gets `PageProps`: `session` (never null — a page exists inside one session),
  `sub` (its own place from the address, undefined at the root), `navigate(sub)`, `back()` and
  `close(focus?)` (back to the conversation; `close("composer")` asks the shell to put the caret
  there). `back()` is the frame's back arrow without the click — to the parent sub-location, adding
  no history step of its own — so a page's own keys go back the way a person's click does.
- **The frame owns the way out.** Close always returns to the conversation. The back arrow appears
  only when the address has a sub-location, and goes to its parent — the sub without its last
  segment, or the page root. That step uses the history entry behind it only when that entry is the
  parent; from a deep link it replaces its own entry instead of leaving the app. The frame focuses
  its active tab on entry unless the page's body claimed the keyboard (a detail's heading, a review
  layer), and closing puts the caret in the composer.
- **The body does not scroll for you.** The frame fills the area and clips; the page's component
  owns its one scroll, so a page with two views keeps each view's position.
- **A badge** works as a panel's does: a component fed `StatusProps`, returning a count or nothing.
- **`tab: false`** leaves the page out of the right sidebar's tabs and out of the Extensions button's
  fallback (and the button does not exist for an extension set whose only pages are tabless). The page
  still routes and renders as any other, reached by its address or by a [header item](#header-items)'s `openPage`.
- `extensions/git-history` is the example: the history list and a commit's detail are two
  sub-locations of one page, and it is `tab: false`, entered from its header badge.

### Tool icons

`web.tsx` may export `tools: [{ id, icon }]`: `id` is the name of a tool the folder registers,
`icon` a lucide icon. The transcript marks that tool's finished steps with it; a tool without one
gets a wrench. The core's own tools (`bash`, `read`, `edit`, …) keep the core's icons.

### Tool argument views

`web.tsx` may export `toolViews: [{ id, args }]`: `id` is the name of a tool the folder
registers, `args` gets the arguments the model sent (unchecked, so read them with a type check) and
returns what the transcript shows in place of their JSON; `null` keeps the JSON. The tool's output
below is unchanged. `extensions/codemode` shows its `code` argument as highlighted JavaScript.

### Session menu items

`web.tsx` may export `sessionMenu: [{ id, label, icon, run, submenu? }]`. Each item sits at the top
of a session row's menu, above Rename, Archive and Delete, with a separator. `run(sessionId)` is the
whole behaviour: the item's label is the toast while it runs, a rejection becomes a toast with its
message, and the list is re-read afterwards, so an item that names the session shows the new name
by itself. `extensions/auto-session-name` is the example.

`submenu` takes the place of `run`: the core wraps the component in a Radix `DropdownMenuSub`, so
the extension supplies rows (`DropdownMenuItem` from `@/components/ui/dropdown-menu`) and nothing
else, and gets `session`. A row whose `onSelect` calls `preventDefault()` keeps the submenu open, so
one visit can set several things; the submenu is mounted only while it is open. `extensions/tags`
puts its tags on and off this way.

### Marks on session rows

`web.tsx` may export `sessionRow: [{ id, component }]`. The component draws inside a session row's
link, between the title and the time, in the sidebar's list and on the home page, wrapped in an error
boundary and given `session`. It is part of the row: no box, border or background of its own, and it
truncates what it says rather than pushing the title out. `extensions/tags` draws its tag chips
there, reading the store shared with its settings form, so a tag made in the Extensions dialog shows
on the rows at once.

### Filters in the session list

`web.tsx` may export `sessionFilter: [{ id, component }]`. The component is drawn in the sidebar's
list header, before the archive button, inside an error boundary, and draws the whole control
itself: an icon button fits the row. The extension that has nothing to filter by draws nothing. It gets
`setMatch(match)`: the predicate the list keeps, or `null` for every session. Call it from an effect
or a handler, never while rendering, and only when the answer moved — a new function re-renders the
list and every row.

The folder scope, the fuzzy search and the archive switch still apply on top, and the counts in the
folder menu stay as they were: a filter narrows the list, it does not re-count the folders.
`extensions/tags` draws a filter icon there that opens a checklist of tags, counts the chosen ones
on the icon, and keeps every session that carries at least one chosen tag.

### Options in the new-session picker

`web.tsx` may export `newSession: [{ id, component, blocked, omit, place }]`. Each option is drawn in
the folder picker's footer, beside the core's own rows, and the component draws the whole option:
`extensions/git-worktree` draws a menu of the repository's worktrees, a checkbox and a name field.
Its props are `{ cwd, use, refused }`:
`cwd` is the folder picked so far, `use(values)` says what the option collected, from an effect
rather than while rendering, and `null` means "the folder as picked". Core keeps those values as
plain JSON and does nothing else with them.

`blocked(values)` answers whether Open can go ahead — while it says no, Open is disabled — and
`place(cwd, values)` runs on Open, when the option collected something: it returns the folder the
session starts in, and a throw keeps the picker open. Either answer reaches the option as `refused`,
which the option says next to its own field: no caption is drawn for it. A failure is said, not
held, so a refusal worth another try can be retried; changing the option's values clears it.
`extensions/git-worktree` makes the worktree there, so the session starts in it without the core
knowing what a worktree is (see [Git worktrees](../extensions/git-worktree/README.md)).

`omit(folders)` answers which of those folders the picker leaves out of its lists — favourites,
recents and the folder being browsed alike — so an option can keep a folder it already offers from
being offered twice. It is called once with the folders of a list whenever that list changes, never
while the picker renders, and a throw leaves the folders as they are; the stored favourites are not
touched, only the rows drawn from them. `extensions/git-worktree` leaves out the worktrees, whose
repository's checkout is the folder to pick.

### Keys for a shell command

`web/src/sdk/commands.ts` holds the shell's commands and, beside them, the keys that run each one.
An extension that binds a key states it there; the core's hints draw it, and the core names no
folder to do so.

```ts
import { setCommandKeys } from "@/sdk/commands.ts";

setCommandKeys("session.new", [["ctrl", "a"], ["c"]]); // ctrl+a, then c
setCommandKeys("session.new", null); // the command shows no key again
```

- **The extension states the caps, the core draws them.** A sequence is one entry per press, and an
  entry is the keys of that press as they are drawn: `[["ctrl","a"],["c"]]` is two presses, and
  `[["shift","left"]]` is one. The core never parses a binding string; a keymap with its own
  grammar stays in the folder that owns it, as `extensions/hotkeys` keeps `prefix+c`.
- **One owner per command.** The last extension to state a command's keys keeps them, and
  `null` clears them, whoever stated them last. A folder states its keys from an effect and clears
  them in that effect's cleanup, so a folder that is turned off or deleted leaves no label behind.
- **An extension's own command is named `extension.<folder>.<command>`.** `ShellCommand` accepts
  any such name without the core knowing the folder, and the component that owns the action states
  the handler with `useShellCommand`; `extensions/git-history`'s header item opens its commit list
  that way. The key for it is stated in the folder that binds keys, here `extensions/hotkeys`, which
  knows the name and nothing else about it.
- **Stating the same sequence again wakes nobody**: the store compares what it holds, so an effect
  that runs on every render does not loop the hints that read it.
- **Reading them:** `useCommandKeys(command)` in a component (it re-renders when the keys change),
  `commandKeys(command)` for the value alone, or `subscribeCommandKeys(listener)` for a store of your
  own. The core's own renderer is `CommandKeys` in `web/src/ui/command-keys.tsx`: one `Kbd` per key
  in a `KbdGroup`, and nothing at all while no extension states any, for
  [Tooltip](ui-primitives.md#12-tooltip)'s `keys` slot.
- `extensions/hotkeys` is the one extension that states keys today: the first binding of each
  command, its prefix's own keys first, so the sidebar's search hint reads `meta` `a` `f` under
  `data/hotkeys.json`'s prefix.

## The host

`host` is what an extension knows about the process. It grows only when a feature needs more:

| Member                  | Is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | The folder's name; use it as the extension's name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `cwd`                   | The folder the app was started in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `dataDir`               | Where the app keeps its state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `log`                   | One line to the server's output                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `onDispose`             | Registers cleanup for the timers and subscriptions this version holds. It runs once: after a newer version is installed or the folder is removed and the tool calls, actions and HTTP requests this version had running have ended, or at once when the server stops. A disposer that throws is logged; the others still run                                                                                                                                                                                                                                                                                                                                                 |
| `onCommit`              | Registers a listener `(view: CommitView) => void \| Promise<void>` called after every commit of every conversation, with `{ session: { id, cwd, owner? }, entries, busy }`, where `entries` is the view's window, the newest 50 to 100 entries, not the whole conversation (read that with `sessionContext`); `owner` is the id of the session that started this one (a task-owned conversation), absent for a session a person created. It is removed when this version is replaced, turned off or deleted; a throw is logged without data                                                                                                                                  |
| `onSessionGone`         | Registers a listener `(session: number) => void \| Promise<void>` called when a session is deleted, so a version can end what it opened for that session — a shell, a page — instead of holding it until the next reload. It is removed when this version is replaced, turned off or deleted; a throw is logged without data and stops neither the other listeners nor the delete. Deleting a session does not delete the sessions it started, so the hook fires for the one id only                                                                                                                                                                                         |
| `sessionRequest`        | `(session) => Promise<{ model, messages, send } \| undefined>`: the conversation's model, the messages its next request would send, and one request on top through the same model runtime, on the hour-long cache. `send(messages, signal, options?)` takes `{ systemPrompt, maxTokens, cacheRetention, sessionId, reasoning }` for a request of its own — the messages you pass are what is sent, not the conversation's. For work that reuses the cache and adds nothing to the transcript; see [Keep warm](../extensions/keep-warm/README.md)                                                                                                                             |
| `sessionPrompt`         | `(session) => Promise<{ model, sections, tools } \| undefined>`: the sections and tool declarations an empty session's first request will carry, rendered as generation renders them — tagged unless the section opts out, an empty or throwing one left out — with no entry written and no model called. The harness's view, not a provider payload. Undefined for a session with entries, an unknown one, no model chosen, or a model outside the catalog; see [Context meter](../extensions/context-meter/README.md)                                                                                                                                                      |
| `sessionContext`        | `(session) => Promise<EntryRecord[] \| undefined>`: the entries the conversation's next request is built from, its newest head marker and everything since, read from the harness when called. Undefined for a session the server does not know; see [Context meter](../extensions/context-meter/README.md)                                                                                                                                                                                                                                                                                                                                                                  |
| `sessionTitle`          | `(session) => Promise<string \| null>`: the name the sidebar shows — the one set by hand from `app.title`, else the conversation's first question — or null while it has neither. Titles belong to the core, so an extension that names a conversation in its own UI asks instead of guessing                                                                                                                                                                                                                                                                                                                                                                                |
| `sessionName`           | `(session) => Promise<string \| null>`: the name someone gave it, by hand or through an extension, without the first question the sidebar falls back to. This is the "is it named yet?" question; `sessionTitle` is the "what do I show?" one                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sessionOwner`          | `(session) => Promise<number \| undefined>`: the id of the conversation that started this one, read from the conversation record. It does not depend on commit publication, so it answers while that conversation's own commits are still on their way; `undefined` covers a conversation a person created and one the core does not know at all                                                                                                                                                                                                                                                                                                                             |
| `sessionWorking`        | `(session) => Promise<boolean>`: whether the session's own run is busy, or any session started from it, at any depth, still works. `SessionSummary.busy` stays the own run only; this is the question to ask before announcing that a session is done                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `setSessionTitle`       | `(session, title) => Promise<void>`: names the conversation for every browser, and an empty title goes back to the first question. The list is sent to the browsers at once, because a title is a document and no commit carries it                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `setSessionCwd`         | `(session, cwd) => Promise<void>`: moves the conversation to another folder; its next request runs there and its history stays. The caller checks the folder and that `sessionWorking` is false. The list is sent to the browsers at once                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `readDoc`               | `(doc, session) => Promise<value>`: the current value of a conversation document, or its initial value while that conversation has none. It is for the places a tool call's `api.snapshot` does not reach, a commit listener and an action. The extension passes its own `defineDoc` token. It only reads: it creates no document and moves no revision                                                                                                                                                                                                                                                                                                                      |
| `notifySessionChanged`  | `(session) => void`: says that something about the session changed which its own commits do not show, such as a conversation this extension started for it. Within 250 ms the server sends that session's `live` event again with a new `revision`, and a web component reads it as `session.revision` in `StatusProps`. Many calls in the window make one event                                                                                                                                                                                                                                                                                                             |
| `notify`                | `(notice: { level: "success" \| "error", message, session?, description? }) => void`: a toast in every open browser tab. With `session` it is that session's own toast, top right for six seconds, and it rides the session list stream, which every tab holds whether or not it shows a session: `message` is the session's title, `description` the line under it, a click opens the session, and a tab already showing that session stays silent, since its transcript shows what happened. Without `session` it is the plain notice the loader sends, in the bottom centre, on the conversation streams a tab showing a session holds. A throw is the caller's to handle |
| `registerModelProvider` | `(provider: Provider) => () => void`: puts a pi-ai provider in the catalog and in front of the model picker, and returns how to take it out. The registration goes with this extension version                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `folderGroup`           | `(resolve: (cwd) => Promise<string \| undefined>) => void`: says which folder a session's folder is shown under in the sidebar's folder menu and in the new session picker, such as the repository a worktree belongs to; undefined leaves it a folder of its own, and a throw counts the same. The first answer in folder order wins. It goes with this extension version, and the list is sent again when it changes                                                                                                                                                                                                                                                       |

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
- **Running calls:** a replaced or removed version's disposers wait for the tool calls, actions and
  HTTP requests of that version that are still running, then run once. There is no timeout, so a
  call that never ends keeps the old version's resources. Hooks are not counted (a pause parks one
  until its disposer lets it go), and neither are provider fetch wrappers and request shapers that
  an in-flight model request already holds.
- **Stop:** `Extensions.dispose()` stops the watcher and runs every disposer at once, without
  waiting for running calls. `server/main.ts` calls it on SIGINT and SIGTERM.

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
its new code. Packages, `node_modules`, and files outside the folder (such as `server/extensions/extensions.ts`)
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

## Extension guides

Each extension's usage, configuration, behavior and limits live in its own `README.md`.
This document holds the shared contract; feature guides link here instead of repeating it.

- [Anthropic subscription](../extensions/anthropic-subscription/README.md)
- [Session names](../extensions/auto-session-name/README.md)
- [Bash timeout](../extensions/bash-timeout/README.md)
- [Caveman](../extensions/caveman/README.md)
- [Code mode](../extensions/codemode/README.md)
- [Dictation](../extensions/dictation/README.md)
- [Git history and embedded review](../extensions/git-history/README.md)
- [Git worktrees](../extensions/git-worktree/README.md)
- [Hotkeys](../extensions/hotkeys/README.md)
- [Image limit](../extensions/image-limit/README.md)
- [Keep warm](../extensions/keep-warm/README.md)
- [Kiro ACP models](../extensions/kiro-acp/README.md)
- [MCP servers](../extensions/mcp/README.md)
- [Notes](../extensions/notes/README.md)
- [Pause](../extensions/pause/README.md)
- [Ponytail](../extensions/ponytail/README.md)
- [Push notifications](../extensions/push/README.md)
- [Subagents](../extensions/subagents/README.md)
- [Terminal](../extensions/terminal/README.md)
- [Usage limits](../extensions/usage-limits/README.md)
- [Fetching a page](../extensions/web-fetch/README.md)
- [Web search](../extensions/web-search/README.md)

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
5. Document its usage, configuration, behavior and limits in the folder's `README.md`; add a link
   under [Extension guides](#extension-guides). Keep shared API documentation in this file.

Deleting the folder is the whole removal, tests included.

## Not built

The browser has no extension-owned routes or URL space of its own. A page is a slot in the shell:
its `sub` is a location inside that page, and the extension decides what it means. Anything that
needs its own HTTP endpoints uses the raw HTTP seam ([Raw HTTP and composer drafts](#raw-http-and-composer-drafts)).

## Header items

`web.tsx` may export `header: [{ id, component }]`. A header item gets the same `StatusProps`
as a status item plus `openPage(id, sub?)`, which opens one of the same extension's own pages (at
`sub`, in one history step, closing any open panel). It renders before the Extensions toggle, follows
the extension's enabled switch and has its own error boundary. The shell knows no feature by name.

[Git history](../extensions/git-history/README.md#header-badge-and-push) uses this slot for its badge.

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
`web/src/lib/sidebar-bottom.ts`. `extensions/subagents` uses this slot for the agents of the open
session.

## Markers in the status popover

`web.tsx` may export `statusRow: [{ id, has, component, submenu? }]`. The status bar's "working"
count opens a list of the sessions at work. For each session, `has(session, sessions)` says whether
the extension puts a marker on its row; the rule is generic: **a row that has a marker is listed
even while its session is idle**, and it does not raise the "working" count. `has` is a plain
function (no hooks) over the full session list, called for every session whenever the status bar
renders, so keep it a cheap filter.

- **`component` is the marker.** It renders inside the row's link, between the title and the time,
  inside an error boundary, with `session`, `sessions` and `openSession(id)` (closes the popover
  and opens the session). It is part of the row, so it has no box, border or background of its
  own, and it stays small: the row keeps the height of the other rows. It follows the extension's
  enabled switch.
- **`submenu` is optional and is the content of the row's submenu.** The core makes the whole row
  the trigger of a Radix `DropdownMenuSub` and renders `DropdownMenuSubContent` around the
  component, so the extension supplies rows (`DropdownMenuItem` from
  `@/components/ui/dropdown-menu`) and nothing else. The first item with a `submenu` wins for a
  row. The submenu is mounted only while it is open.
- **Why `has` and not a component that returns `null`.** The core must know before it renders
  whether a row is listed, and a hidden Radix menu item still takes part in keyboard navigation.
- **Why the click is handled by the core.** Radix opens a submenu when its trigger is clicked, so
  a trigger that is also a link needs its `onClick` to call `preventDefault()` (Radix then skips
  its own open) and open the session itself. Hover, ArrowRight and Space still open the submenu
  through Radix.

How a row with a submenu behaves:

| Input               | Wide screen (640px and up)                              | Narrow screen                                                         |
| ------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Mouse over the row  | Opens the submenu beside the row after Radix's delay    | Nothing (no hover on a phone)                                         |
| Leaving the row     | Closes it, unless the pointer crosses into it           | Not applicable                                                        |
| Click on the row    | Opens the session                                       | First click opens the submenu below the row; second opens the session |
| Touch, first tap    | Opens the submenu; the second tap opens the session     | As the click above                                                    |
| Enter               | Opens the session                                       | As the click above                                                    |
| ArrowRight or Space | Opens the submenu and focuses its first row             | Space is a click                                                      |
| ArrowLeft, Escape   | ArrowLeft closes the submenu; Escape closes the popover | Escape closes the popover                                             |

Radix puts a submenu beside its row and offers no other side, which on a phone would cover the row
or run off the screen, so below 640px the submenu opens inline under the row, inside the popover.
Keyboard focus alone does not open the submenu: it would move focus while someone arrows through
the list.

- Sessions started from another session (`parent` in the full list) are not rows of the popover,
  as they are not in the sidebar. Whoever started them counts them, so a count of the agents is
  the extension's own status item. A child whose parent is gone is a row like any session.

## Composer items

`web.tsx` may export `composer: [{ id, component }]`. The component renders in the composer's row,
before Send, inside its own error boundary, and follows the extension's enabled switch. Its
props are `StatusProps` plus `field` (a ref to the message box), `setText(value)` (replaces the
text as typing would, so the draft keeps it) and `onSent(listener)` (runs just before a message is
sent; returns the way to stop listening). The shell knows no feature by name.

[Dictation](../extensions/dictation/README.md) uses this slot for its microphone.

## Provider request shaping

The generic `host.shapeModelRequests(shape)` seam receives `(payload, model)` immediately
before transmission. Return a replacement or `undefined` to leave the payload untouched.
Registrations follow the extension's disposal lifecycle. The harness wraps both streaming
turns and non-streaming compaction requests, preserving any existing `onPayload` callback.
The core seam requires a server restart on first installation; subsequent extension changes
and toggles apply live to new requests.

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

[Anthropic subscription](../extensions/anthropic-subscription/README.md#extension-details) uses this
facet for request diagnostics and account lookup.

## Resolved model transport

`host.wrapModelFetch((next, model) => fetch)` wraps the final model HTTP transport,
including its resolved authorization and User-Agent headers. Registrations follow the
same replacement/disposal lifecycle as payload shapers. Call the supplied `next` rather
than global fetch, preserving caller transports, signals and streaming responses.
Never log or retain credentials. Installing this new core capability requires a restart.

## Model authorization

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
see [Git history and embedded review](../extensions/git-history/README.md).
