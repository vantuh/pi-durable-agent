# Layout

Three floating panels with a gap between them, on a darker page, and one status bar underneath. This
is the shape we settled on after the mockup: cards with gaps, not flush columns — the gaps are what
tell a panel from the page.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ page: bg-sunken, 8px padding, 8px gaps                                       │
│ ┌────────────────┐ ┌───────────────────────────────────────┐ ┌────────────┐  │
│ │ Sessions       │ │ Session name            ⎇ branch  ⚙   │ │ Settings   │  │
│ │ 264px, drag    │ ├───────────────────────────────────────┤ │ 360px      │  │
│ │ folder pill    │ │ transcript  (the only scroller)        │ │ closed by  │  │
│ │ list of rows   │ │                                        │ │ default    │  │
│ │                │ ├───────────────────────────────────────┤ │            │  │
│ │                │ │ composer                               │ │            │  │
│ └────────────────┘ └───────────────────────────────────────┘ └────────────┘  │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ● ready  ~/project  ⎇ main          model            ↑in ↓out · $cost   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

The roles, top down: page `sunken`, panels `canvas`, anything inside a panel that must stand out
(`raised`): the selected session row, a person's message, a hover on a control. Borders are
`edge-soft` inside a panel and never on the page. See [theme.md](theme.md).

## Home

`/` is the home page, in place of the conversation and composer: every session from every folder
that is not archived, under `Working`, `Not viewed`, and `Recent` (the newest 20). A row shows its
mark, title, folder and time. `?session=N` is a session; moving between them adds a history step,
so Back returns home. There is no router: two places do not need one, and these are the links
pushes already send. See [sessions-live.md](sessions-live.md).

## Sidebar

- **Top**: the app icon at the left edge, which goes home, `Sessions`, the collapse button at the
  right edge, and a pill with the folder the conversation
  works in; on the home page, the folder of the last session opened. The pill opens a list of the folders
  that sessions use, with the session count of each; choosing one opens its latest session. The
  `+` (new session) button opens `FolderPicker`: it browses the server's folders (hidden ones
  optional), lists recent folders and favourites (kept through `/api/favourites`), and creates a
  session in the folder you open.
  `FolderPicker`, the model menu, and the attachment preview are all `Dialog` modals
  (`components/ui/dialog.tsx`): Escape closes them, focus stays inside and returns on close. The
  parent owns `open`; each modal calls `onClose`. The sessions sheet below `lg` is not a `Dialog`:
  it is the sidebar itself, shown as a sheet.
- **List**: a row per session: a state dot (idle `faint`, working `warn`), the title, and how long ago
  its newest run started (`now`, `5m`, `2h`, `3d`, then a date). The title is the first thing that
  was asked, cut at 80 characters. Rows are grouped `Today`, `Yesterday`, `This week`, `Older`, each
  with its count; a session with no known time is under `Older` and shows no time.
- **Started from another session**: a session with `parent` (the one it was started from) is not a
  row while that parent is in the full session list, whatever the folder, archive or search
  filter. The folder counts, the group counts and the search follow the rows shown. When such a
  session is open, its parent's row takes the open row's background and `aria-current="true"`. A
  child whose parent is not in the list stays a row, so nothing becomes unreachable. Everything
  else (status bar, toasts, unseen, the home page, recent folders) still reads the full list.
  The rule is `web/src/lib/session-nesting.ts`.
- **A parent whose started sessions work**: while a session is not working itself and at least one
  session started from it is (`workingChildren` over the full list), its row shows the animated
  working mark in the agent colour (`text-agent`) instead of the idle or unseen mark. The mark's
  tooltip and label say `N agents working` (`1 agent working` for one). When the session works
  itself, the usual working mark stays; with no working child the unseen dot is as before. The row
  has no submenu: the status bar's popover has that.
- **Rows are links** (`?session=N`): a plain click opens the session in place, a modified or middle
  click opens it in a new tab.
- **Where the time comes from**: the `app.clock` document of each conversation (`activeAt`), set when
  the session is created, when any of its runs starts (a person's message, a subagent's task, an
  extension's input), and on every message a person sends into a run already under way. A session
  older than the document takes the start time of its newest message once, then keeps it.
- **Width**: 264px to start. Drag the right edge, or focus it and press `←` / `→` (16px a step),
  to set it between 204px and 464px, never past 40% of the screen. The width is kept in
  `localStorage` (`sidebarWidth`); a double click on the edge puts it back to 264px.
- **Under the list**: extensions may add an area with its own height (`sidebarBottom`, see
  [extensions.md](extensions.md#under-the-session-list)), with a drag handle between it and the list.
- The search field is not drawn yet.
- Hidden below `lg`, where the conversation takes the screen. There, the panel icon in the
  conversation header opens the list as a full-screen sheet; choosing a session closes it.

## Conversation

- **Header**: the session title, the `title` slot in a small line under it (the branch badge of
  `extensions/git-branch`, and a worktree badge in a linked worktree, from `sm`), and the settings gear. The folder is the sidebar's. The mockup's other three
  buttons (file browser, web, subagents) arrive with their extensions and take this same row.
- **Transcript**: the one scroll container, centred at `max-w-[46rem]`.
    - **What is loaded**: the event stream carries the active view, which starts at the newest
      compaction; the entries before it are asked for as the reader scrolls up. Within 240px of the
      top, `web/src/lib/conversation.ts` calls `/api/history?before=<oldest id>`
      ([server.md](server.md)), and the page is added in front. The spinner (`earlier messages`)
      sits at the top of the transcript and sticks there while a page is on its way. The scroll
      position is kept by measuring the height before and after a page that arrives in front: the
      words the reader was looking at do not move. Nothing is asked for once the first entry is on
      screen, and nothing the server rewrites can take loaded entries away: the list is an upsert by
      id (`web/src/lib/conversation-state.ts`).
    - **Where a compaction cut**: a line across the transcript with a filled `raised` pill on it —
      layers icon, `earlier messages were compacted`, chevron — and the summary the model was handed
      under it (folded, opened by a tap). No count: what a person wants to know is where the cut is
      and what was kept, and a number above it is only true once the start of the conversation is on
      screen, which after a fresh compaction it is not.
    - **While a compaction runs**: there is no entry yet, so the same pill sits at the end of the
      transcript — `compacting earlier messages` and a spinner, nothing to open. That is exactly where
      the marker lands when the summary commits, so the spinner turns into the mark in place. It comes
      from the harness's live document (`pi.live.compactions`, projected as `live.compacting`), which
      covers a `/compact` as well as the threshold compaction a run does on its own.
    - **When it fails**: an attempt waiting to try again says `compaction failed, retrying` in the `warn`
      tone and keeps its spinner; one that gave up turns the pill `danger`, `compaction failed`, with the
      error under it. The red pill stays until a compaction succeeds — the harness keeps the failure until
      then, and it is true: what came before is still what the model is sent. The pill is a role, not a colour's meaning: filling it with `accent` or `warn` would
      read as "live" or "broken", and a compaction is neither. The messages above it stay on screen:
      they are the conversation, they are just no longer what the model is sent. The mark is
      `pi.compaction`'s entry, projected as `kind: "compaction"` and placed by `turnsOf`.
    - A person's message: a `raised` card on the right, at most 80% wide.
    - **Quoting an answer**: words selected inside an answer bring a `Quote` button past their
      right corner, off the end of the line; a tap takes them to the composer, where they wait as a
      `panel` card with a quote mark in its corner, above what is being written. A quote is the
      message's own leading blockquote (`web/src/lib/quote.ts`): it reaches the model as `> …`, the
      sent message shows one card per quote, in the same order, above the person's words, and the
      raw `>` never appears. Only an answer is quotable — not the activity line, not a person's own
      message.
    - An answer: plain prose at 15px, no card, no name. Above it, one mono line of statistics:
      `model · level` on the left, `↻cached% · ↑context ↓output · $cost · time` on the right (the
      turn's newest prompt, how much of it the provider served from its cache, and output and cost
      summed over its responses); it ticks while the run is live. The arrow is left out when nothing
      was cached.
    - Thinking and tool calls between two of Pi's words fold into one activity line
      (`Thought, read 2 files and ran 1 command · 1 failed · 12s`), across answers, closed by default.
      A `git commit` among the calls is its own word (`Ran 2 commands and committed`) and is not
      counted among the commands.
      Opened, it is a timeline: a line per step with its status, name, subject and time; a step opens
      to its arguments and output. The grouping is `web/src/lib/turns.ts`, after Pi Pocket's `turns.js`.
      An opened `edit` is a diff card (`details.diff` of its result, line numbers, the changed words
      marked); an opened `write` is its file as a highlighted code block.
- **Composer**: `sunken` card, textarea grows with its content from 2 to 10 lines (including wrapped
  lines), then scrolls internally. Native CSS `field-sizing: content` also shrinks it when text is
  removed or sent. `Enter` sends, `Shift+Enter` breaks the line. A command typed in the box
  (`/compact`, `/new`) is run instead of sent and never enters the transcript: `/new` opens a new
  session in the folder this one works in. `/` opens a list of the commands and the session's skills,
  narrowed as you type, walked with the arrows and taken with `Enter` or `Tab`; a picked command or
  skill is inserted and the list closes. While a run is
  live, Stop appears beside Send and a row of **Steer / Queue / Interrupt** says how the message goes:
  after the current tool round (`whenBusy: "steer"`), after the answer (`"followUp"`), or now (abort,
  then send; it goes back to Steer after one use). Messages waiting in `pi.inbox` are cards above the
  card (`web/src/composer/queued.tsx`): a `raised` card with a 3px stripe, `accent` for Steer and
  `info` for Queued, the mode and what it waits for, the text clamped to two lines (a tap opens it),
  the names of its files, and two buttons. ✕ withdraws it: the agent never reads it. ✎ withdraws it
  and puts it back in the composer with its mode and its files, so it can be changed and sent again;
  a draft already there stays, and the message goes below it as one more paragraph. The card shows
  the entry the input will be placed as, so a `/skill:` message comes back as the command, not as the
  instructions it expands to. The model chip opens `ModelMenu`: a search over the scoped or all models, with a thinking
  level. Picking one calls `POST /api/agent` for the open session; "make default" calls
  `POST /api/default` for new sessions.

## Settings

A panel on the right. Under its sections is a footer row with two icon buttons: a puzzle
("Extensions") that opens a modal to turn extensions on and off ([extensions.md](extensions.md)),
and a palette ("Appearance: theme") that opens a modal with one card per flavour
([theme.md](theme.md)). Both modals are full screen below `sm` and a centred card from `sm` up;
their content scrolls.

## Status bar

One bar across the bottom, always visible, for the state of the app; what one conversation used sits
under the composer, and its branch beside its title.

| Field            | Source                       | Shown when                  |
| ---------------- | ---------------------------- | --------------------------- |
| state            | `pi.live.run` and the stream | always                      |
| 5-hour limit     | `extensions/usage-limits`    | end slot                    |
| warm             | `extensions/keep-warm`       | end slot                    |
| extension fields | `status` export of a folder  | only with that extension on |

The state is a button: after it, how many other sessions work (`· 2 working`) and finished unseen
(`· 1 new`), counted from the session list stream. A click opens a menu above it: the open session
first, on `raised`, then the working and the unseen ones (`sunken` under the pointer), each a link
that opens it, then `All sessions` for the home page.

The bar has three slots (`start`, `center`, `end`) that extensions fill.

## Under the composer

One centred line under the composer card, about the open conversation: the `composer` slot. The
context meter (`extensions/context-meter`), then the fields (`cache` from `extensions/cache-hit`,
`tok/s` from `extensions/tokens-per-second`), then `↑in ↓out · $cost` from the `pi.usage` document.
It never grows a second line: what does not fit wraps out of sight whole, so on a phone the last ones
go first.

## Stacking

`lg` (1024px) is the line. Wider: three panels, the drawer inside the row. Narrower: the sidebar
goes, the drawer becomes a full-screen overlay, the header drops the branch.
