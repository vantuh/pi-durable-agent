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

## Sidebar

- **Top**: `Sessions`, and a pill with the folder the conversation works in. The pill opens a list of the folders
  that sessions use, with the session count of each; choosing one opens its latest session. The
  `+` (new session) button opens `FolderPicker`: it browses the server's folders (hidden ones
  optional), lists recent folders and favourites (kept through `/api/favourites`), and creates a
  session in the folder you open.
- **List**: a row per session: a state dot (idle `faint`, working `warn`), the title, and how long ago
  a person last wrote to it (`now`, `5m`, `2h`, `3d`, then a date). The title is the first thing that
  was asked, cut at 80 characters. Rows are grouped `Today`, `Yesterday`, `This week`, `Older`, each
  with its count; a session with no known time is under `Older` and shows no time.
- **Where the time comes from**: the `app.clock` document of each conversation (`activeAt`), set when
  the session is created and on every message sent. A session older than the document takes the start
  time of its newest message once, then keeps it.
- **Width**: 264px to start. Drag the right edge, or focus it and press `←` / `→` (16px a step),
  to set it between 204px and 464px, never past 40% of the screen. The width is kept in
  `localStorage` (`sidebarWidth`); a double click on the edge puts it back to 264px.
- The search field is not drawn yet.
- Hidden below `lg`, where the conversation takes the screen. There, the panel icon in the
  conversation header opens the list as a full-screen sheet; choosing a session closes it.

## Conversation

- **Header**: the session title and the settings gear. The branch item of `extensions/git-branch` lives in the status bar only. The mockup's other three
  buttons (file browser, web, subagents) arrive with their extensions and take this same row.
- **Transcript**: the one scroll container, centred at `max-w-[46rem]`.
    - A person's message: a `raised` card on the right, at most 80% wide.
    - An answer: plain prose at 15px, no card, no name. Above it, one mono line of statistics:
      `model · level` on the left, `↑context ↓output · $cost · time` on the right (the turn's newest
      prompt, and output and cost summed over its responses); it ticks while the run is live.
    - Thinking and tool calls between two of Pi's words fold into one activity line
      (`Thought, read 2 files and ran 1 command · 1 failed · 12s`), across answers, closed by default.
      Opened, it is a timeline: a line per step with its status, name, subject and time; a step opens
      to its arguments and output. The grouping is `web/src/lib/turns.ts`, after Pi Pocket's `turns.js`.
      An opened `edit` is a diff card (`details.diff` of its result, line numbers, the changed words
      marked); an opened `write` is its file as a highlighted code block.
- **Composer**: `sunken` card, textarea, `Enter` sends, `Shift+Enter` breaks the line. While a run is
  live, Stop appears beside Send and a row of **Steer / Queue / Interrupt** says how the message goes:
  after the current tool round (`whenBusy: "steer"`), after the answer (`"followUp"`), or now (abort,
  then send; it goes back to Steer after one use). Messages waiting in `pi.inbox` are listed above the
  card. The model chip opens `ModelMenu`: a search over the scoped or all models, with a thinking
  level. Picking one calls `POST /api/agent` for the open session; "make default" calls
  `POST /api/default` for new sessions.

## Status bar

One bar across the bottom, always visible:

| Field              | Source                       | Shown when                         |
| ------------------ | ---------------------------- | ---------------------------------- |
| state              | `pi.live.run` and the stream | always                             |
| `↑in ↓out · $cost` | `pi.usage` document          | always                             |
| folder             | `/api/health`                | `sm` and wider                     |
| branch             | `extensions/git-branch`      | `sm` and wider, in a git folder    |
| extension fields   | `status` export of a folder  | only with that extension on        |
| context meter      | `extensions/context-meter`   | centre slot, once an answer exists |
| cache hit          | `extensions/cache-hit`       | start slot, once an answer exists  |
| agents             | the subagents extension      | only with that extension on        |

The bar has three slots (`start`, `center`, `end`) that extensions fill. `tok/s` is an `end` field: `extensions/tokens-per-second`. Below `sm` the path and the branch item of `extensions/git-branch`
are dropped and the model name truncates, so the bar never widens the page.

## Stacking

`lg` (1024px) is the line. Wider: three panels, the drawer inside the row. Narrower: the sidebar
goes, the drawer becomes a full-screen overlay, the status bar drops the path.
