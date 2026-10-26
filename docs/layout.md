# Layout

Three floating panels with a gap between them, on a darker page, and one status bar underneath. This
is the shape we settled on after the mockup: cards with gaps, not flush columns — the gaps are what
tell a panel from the page.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ page: bg-sunken, 8px padding, 8px gaps                                       │
│ ┌────────────────┐ ┌───────────────────────────────────────┐ ┌────────────┐  │
│ │ Sessions       │ │ Session name            ⎇ branch  ⚙   │ │ Settings   │  │
│ │ 264px          │ ├───────────────────────────────────────┤ │ 360px      │  │
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

- **Top**: `Sessions`, and a pill with the folder the conversation works in. The pill is a label
  today; it becomes the folder picker when sessions can be created.
- **List**: a row per session: a state dot (idle `faint`, working `warn`), the title, and when it
  last changed. The title is the first thing that was asked, cut at 80 characters.
- **Grouping** (`Today`, `Yesterday`, `This week`) and the search field need timestamps we do not
  store yet. Not drawn until they are real.
- Hidden below `lg`, where the conversation takes the screen. A sessions button for small screens
  comes with the session list work.

## Conversation

- **Header**: the session title, the branch, and the settings gear. The mockup's other three
  buttons (file browser, web, subagents) arrive with their extensions and take this same row.
- **Transcript**: the one scroll container, centred at `max-w-[46rem]`.
    - A person's message: a `raised` card on the right, at most 80% wide.
    - An answer: plain prose at 15px, no card, no name — the answer's statistics line from the
      mockup (`model · ctx · cost · time`) comes with tool folding.
    - A tool call: one dim mono line, `⌘ name`, until folding lands.
    - Thinking: dim italic metadata.
- **Composer**: `sunken` card, textarea, `Enter` sends, `Shift+Enter` breaks the line. The send
  button becomes Stop while a run is live. Model reads as a label; the selectors become live when
  the agent state is editable from the page.

## Status bar

One bar across the bottom, always visible:

| Field              | Source                       | Shown when                  |
| ------------------ | ---------------------------- | --------------------------- |
| state              | `pi.live.run` and the stream | always                      |
| `↑in ↓out · $cost` | `pi.usage` document          | always                      |
| model              | the conversation             | always                      |
| folder, branch     | `/api/health`                | `sm` and wider              |
| agents             | the subagents extension      | only with that extension on |

`tok/s` from Ultimate is not here: nothing in the server measures it.

## Stacking

`lg` (1024px) is the line. Wider: three panels, the drawer inside the row. Narrower: the sidebar
goes, the drawer becomes a full-screen overlay, the status bar drops the path.
