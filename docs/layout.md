# Layout

The shell is three regions on one horizontal axis, and one scroll container inside it. This is
the minimum that feels like Pi Pocket without carrying its settings, panels, and sheets.

```text
┌──────────────────┬───────────────────────────────────┬──────────────────┐
│ sidebar  264px   │ conversation          flexible    │ drawer   360px   │
│                  │ ┌───────────────────────────────┐ │                  │
│ workspace        │ │ header                        │ │ tabs:            │
│ session list     │ ├───────────────────────────────┤ │  Changes         │
│                  │ │ transcript   (scrolls)        │ │  Files           │
│                  │ ├───────────────────────────────┤ │  Run             │
│ model, status    │ │ live strip + composer         │ │                  │
└──────────────────┴───────────────────────────────────┴──────────────────┘
```

The drawer is closed by default, so the conversation gets the whole width until something asks
for it.

## Sidebar

Always visible on a wide screen. It is the only navigation.

- **Top**: the folder the agent works in, its git branch, a new-session button, and a collapse
  control.
- **Session list**: rows of title, relative time, and a state mark — idle, working, waiting for
  approval, failed. Grouped as `Working`, `Today`, `Earlier`. A search field above them.
- **Bottom**: model and thinking level, and the numbers we will have once the server reports them
  (tokens, cost).

Selecting a row swaps the conversation and nothing else. No tabs, no panes, no worktrees.

## Conversation

- **Header**: session title, folder, branch. Actions on the right: the Changes and Files counts,
  and the drawer toggle.
- **Transcript**: the one scroll container. Newest content grows at the bottom, and the view
  follows new words until the user scrolls up.
    - A person's message is a plain block, distinguishable by weight and alignment, not by a
      bubble library.
    - The agent's answer is prose at reading size.
    - Runs of tool calls fold into **one line per group** — what it did and how long it took, such
      as "read 3 files, ran 2 commands · 8s" — which expands into a timeline of steps. This is
      the single most important piece of the transcript: it keeps a long run one line tall.
- **Live strip**: what the model is doing right now, elapsed time, and Stop. Sits directly above
  the composer, never in the scroll area.
- **Composer**: pinned to the bottom. A textarea that grows to a limit, a model chip, and a
  send button that becomes Stop while a run is live.

## Right drawer

Off by default; opens from the header, from `⌘J`, or by itself when an approval waits.

- **Changes** — the uncommitted diff for the session folder. Hardest of the three and the reason
  the drawer exists at all.
- **Files** — a tree of the session folder beside a viewer.
- **Run** — the task graph `pi-durable` already knows: the current run, its tool calls, subagents,
  and approvals, with a Stop for each.

## Narrow screens

Below 1024px the shell stops being three columns.

- The sidebar becomes an overlay drawer over the conversation.
- The right drawer becomes a full-height sheet.
- The composer stays pinned, with the safe-area inset as bottom padding.
- Nothing else changes, so every feature is reachable on a phone without a second layout.

## States

| State            | What the shell shows                                        |
| ---------------- | ----------------------------------------------------------- |
| No session       | Sidebar and an empty conversation area, nothing else        |
| Idle             | Last answer, composer focused on a wide screen              |
| Streaming        | Live strip, Stop replaces Send, transcript follows          |
| Waiting approval | The call in the transcript, plus the drawer opened on `Run` |
| Failed           | The reason attached to the turn that failed, with Retry     |
| Stopped          | A "stopped" line under the turn; composer back to Send      |

## Tokens

Radii, spacing, and type sizes are decided here once so components do not invent them:

- **Radius**: 6px controls, 10px cards, full for pills and avatars.
- **Spacing**: 4px base; the shell uses 8, 12, 16, 24.
- **Type**: 13px interface, 15px conversation prose, 12px metadata, mono for code and paths.
- **Colour**: only through the `--role-*` names in `web/src/styles.css`, which map onto
  `catppuccin.css`. A component that names a palette colour directly is a bug
  ([theme.md](theme.md)).

## Build order

This document is about the shell, which is core. The order for the whole app — server, loader,
shell, then features as extensions — is in [../AGENTS.md](../AGENTS.md#how-we-build-in-order).

Inside the shell, each step is visible in the browser before the next starts.

1. Three regions and the grid, no data.
2. Transcript drawn from the event stream.
3. Composer, streaming text, Stop.
4. Tool calls as folded activity lines, expanding to a timeline.
5. Sidebar and the session list.
6. Drawer: `Run`, then `Files`, then `Changes`.
