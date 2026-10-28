# Subagents design preview

This is a standalone, sample-data mockup for approval, **not an installed feature**. It makes no
API requests, starts no agents, and does not modify the real app's session list or storage.
The sample sidebar is scenery; its separate, resizable subagents area is a later step.

Run from the repository root, using a free port:

```bash
pnpm exec vite docs/mockups --config vite.config.ts --host 127.0.0.1 --port 5193 --strictPort
```

Open <http://127.0.0.1:5193/subagents.html>. The explicit config is needed for Tailwind and the
existing app theme. No backend needs to be started; no `/api` routes are called.

## Version 1: working-agents grid

- Lives directly above the composer, scoped to the current parent session.
- Shows only working agents. With none, the whole section disappears, without an empty-state row.
- Each link shows the sidebar's existing animated working mark, agent name, a context-fill bar
  and percentage, and output speed. Unknown speed is a dash, never a fabricated zero.
- Model is secondary: use the preview's **Show model** checkbox to compare a compact row against
  a two-line row. The hover title includes model, profile, estimated context counts, and the
  meaning of the speed figure in either mode.
- Click a row to preview the child's own conversation. A visible link returns to the parent.
  Child views do not pretend that the parent's other agents belong to that child.
- Desktop uses two columns; narrow screens use one. Long lists scroll within a bounded height
  instead of pushing the composer away. Mobile links are at least 44px tall.
- Context is an estimate, like the current context meter. Speed follows the existing TPS meaning:
  output tokens over the last completed response, including first-token wait, **not live speed**.
  Live metrics and the server/browser contract still need implementation after approval.

The top controls are preview-only: 0/1/3/6 active agents, model visibility, and Mocha/Latte. Links
preserve the preview choices in the query string. Send is disabled. Other shell controls are
illustrative, not working replacements for the real app.

## Version 2: compact horizontal strip

Open <http://127.0.0.1:5193/subagents-compact.html?count=3> separately to compare with
[version 1](subagents.html?count=3). The version 1 CSS and script are unchanged; its HTML only moved the return-to-parent link above the composer.
Version 2 has its own HTML entry and a small CSS override over the same theme/sample behavior.

- No separate heading above the agents. The count remains available to screen readers.
- All agents stay on one horizontal line, with the same working mark, name, and context
  bar/percentage. Speed (tok/s) is hidden in this version. The whole chip remains a conversation link.
- The strip scrolls horizontally when its contents do not fit. This saves vertical space but means
  not all agents are visible at once, especially on a phone. A partially visible next chip and the
  scrollbar indicate more content.
- Chips are 36px tall on desktop and 40px on mobile. This is below the 44px touch target used in
  version 1. Turning **Show model** on
  adds the model inline, not a second line. This uses more width; a native desktop scrollbar can
  add height when the strip overflows (11px in the tested browser).
- Empty state, child navigation, and sample-data isolation match version 1. In a child
  conversation, the return-to-parent link replaces the strip above the composer, with the same
  height, so the composer does not move.

Measured area heights with three sample agents and models hidden (excluding the shared 8px gap
above the composer):

| Viewport            | Version 1 | Version 2 | Height recovered for the transcript |
| ------------------- | --------- | --------- | ----------------------------------- |
| Desktop, 1280 × 800 | 110px     | 40px      | 70px                                |
| Phone, 390 × 844    | 172px     | 44px      | 128px                               |

This variant has not been selected for implementation. Compare both before choosing the tradeoff
between all-at-once visibility and transcript height.

## Step 2: sidebar agents area

Open <http://127.0.0.1:5195/agents-area.html> (the earlier previews use 5193; this one was run on
5195). Run it from the repository root with the same command and the port changed:

```bash
pnpm exec vite docs/mockups --config vite.config.ts --host 127.0.0.1 --port 5195 --strictPort
```

This is also a standalone, sample-data mockup: no API calls, no backend, no live agents, and a
**PREVIEW** badge in the toolbar. It continues [version 1](subagents.html?count=3) and
[version 2](subagents-compact.html?count=3): the strip above the composer is kept, and the sidebar
gains the area described below. The strip's own CSS is reused unchanged.

### What it shows

- **Main list: normal sessions only.** Agent conversations are not rows in it.
- **Agents area, under the list in the same column.** Titled "Agents of _<parent>_", with the total
  count. One row per agent, working first, then finished newest first. A working agent has the
  animated `.state-mark.working`; a finished one has the idle mark (or a green filled mark if it
  finished unseen). The secondary text is `working` or `finished 4m ago`.
- **Click a row** to open that agent's conversation in the main panel, with the "Back to <parent>"
  link above the composer, in the slot the strip used.
- **The open agent** is marked with the same background fill as the selected session row in the
  main list. It has no extra border or frame.
- **A parent with no agents** has no area, no grip, and no heading.
- **A child open:** its parent stays highlighted in the main list. The area still lists every
  sibling.
- **Resizing.** A grip between the list and the area drags the area's height. Keyboard on the
  focused grip: ArrowUp/ArrowDown change it by 16px (Shift: 64px), Home/End go to the minimum or
  maximum, Enter resets. Double-click resets. The size is stored in `localStorage` under
  `agents-area:height`. The grip turns yellow at a limit. The footer reads out the current area
  height, its bounds and the list height.
- **Narrow screens (below 1024px):** the sidebar is a drawer over the page, collapsed by default.
  The area stays under the list inside the drawer. Choosing a conversation closes the drawer,
  and the header shows a small "N working" hint next to the menu button. The hint counts only
  the open parent's agents, so it can be lower than the status line, which counts all parents.
- **Long list:** the 12-agent state scrolls inside the area's own bounds. Opening a child scrolls
  its row into view inside the area.

### Agents in the status bar (decided)

Agents are counted **separately and are not added to the session totals**. The status line keeps
the session figures exactly as they are, and agents are their own item after them:
`ready · 1 working · 1 new · 6 agents working`. The item counts the working agents of all
parents and is hidden when none is working. The open agent is not counted, as the open session
is not.

Click the status line to open the mocked popover. It has the box of the real sessions popover
(320px wide). It keeps the real structure: the open session first, then other sessions, or "No
other session is working", and an "All sessions" row (not wired in the mockup). **Agents have no
rows and no section of their own in it.** A session is listed when it works, is unseen, or has
working agents, so a parent whose only activity is its agents still has a row.

A parent row with working agents has a small marker at its right: the working mark and the
count, for example `▪ 3 ›`. The sample data has Theme contrast pass with 3, Profile model
validation with 1, the open Subagent workspace with 2 (4 in the 12-agent state), and Session
archive notes with none, which has no marker. The marker opens a submenu of that parent's
**working** agents only: a heading with the parent's name and "N working", then one row per agent
with the working mark and the name. A click on an agent opens its conversation. A click on the
parent row itself still opens the parent.

- **Mouse:** hovering the row or its marker opens the submenu. Moving to a row without a marker,
  or out of the popover, closes it after 250ms, which leaves time to cross the gap into the
  submenu. Clicking the marker pins it open until a second click, Escape, or a click elsewhere.
- **Keyboard:** focusing the row's link or its marker opens the submenu. Tab goes on to the
  marker and then into the submenu's rows in order, and Tab out of the row closes it. ArrowRight
  moves into the list, ArrowUp and ArrowDown move within it, ArrowLeft goes back to the marker.
  Enter or Space on the marker pins the submenu and focuses its first agent.
- **Touch:** tapping the marker opens the submenu and a second tap closes it. Tapping the row
  opens the parent. Touch never opens it by hover. The marker is 56 × 44px on narrow screens.
- **Escape** closes the submenu first. A second Escape closes the popover.
- **Placement:** to the right of the popover, then to its left, then below the row (above it if
  the window ends first), and always inside the window. In the default layout there is room on
  the right on desktop, and on a phone the submenu goes under or over the row at the row's width.
  The submenu sits inside the hovered row in the page, so the row stays highlighted while the
  pointer is in it.

### A child whose parent is missing (decided)

Such a child is not hidden. It appears as a top-level row in the main list, tagged `agent`, and
there is no agents area for it. This should be rare: it only happens if the parent was deleted
from the sidebar. It is a safety net so that no agent becomes unreachable, not a designed
feature. Open the **Parent missing** scenario to see it. Its rows count as ordinary sessions in
the status line.

### Preview controls

Scenario (no agents, 3 agents, 12 agents, child open, parent missing), Sidebar (open or
collapsed), Theme (Mocha or Latte), **Reset area size**, and the one open decision below. They
are kept in the query string, for example
`?scenario=many&theme=latte&finished=check&sidebar=open`. On a phone the controls start
collapsed; `?controls=1` opens them. Opening another parent, or one of its agents, from the popover
uses `?scenario=other&parent=profile` or `&parent=theme`, which has no button of its own.

### Measured sizes

Measured in the browser with sample data. Rows have fixed heights so the bounds are exact.

| Value                                     | Desktop, 1280 × 800 | Phone, 390 × 844 (drawer) |
| ----------------------------------------- | ------------------- | ------------------------- |
| Sidebar height                            | 628px               | 693px                     |
| Agent row                                 | 32px                | 44px                      |
| Session row                               | 40px                | 44px                      |
| Area heading                              | 28px                | 28px                      |
| Grip height                               | 10px                | 16px                      |
| Area minimum (heading + 2 rows + padding) | 96px                | 120px                     |
| List minimum (heading + 3 rows)           | 148px               | 160px                     |
| Area maximum in this window               | 318px               | 357px                     |
| Default area, 3 agents                    | 128px               | 164px                     |
| Default area, 12 agents                   | 224px (6 rows)      | 296px (6 rows)            |

The default height fits the agents up to six rows, then the area scrolls. The maximum depends on
the window: it is what is left after the top of the sidebar, the grip and the list minimum.

Status popover: 320px wide (at most the window minus 24px) and 248.5px tall in every scenario,
with four parent rows of 49.5px each. The marker is 52 × 32px on desktop and 56 × 44px on narrow
screens.

Submenu, measured when opened: 24px heading, agent rows of 27.5px on desktop and 44px on a phone.

| Parent (agents)                  | Desktop, 1280 × 800 | Phone, 390 × 844 |
| -------------------------------- | ------------------- | ---------------- |
| Profile model validation (1)     | 223 × 61.5px        | 310 × 78px       |
| Subagent workspace (2)           | 210 × 89px          | not measured     |
| Theme contrast pass (3)          | 211 × 116.5px       | 310 × 166px      |
| Subagent workspace, 12-agent (4) | 211 × 144px         | 310 × 210px      |

The submenu list scrolls past 220px or 45% of the window height, whichever is less.

### Open decision

- **C. A finished agent.** "Dimmed + time" shows a muted title and `finished 4m ago`. "✓ + context"
  shows a check mark (green if not yet viewed) and the final context percentage, amber above
  70%. Neither shows both.

### Behaviour chosen in the preview, not by the owner

- One stored area height is shared by every parent and by both desktop and phone. A height saved
  while looking at 12 agents leaves empty space under 3 agents.
- Agents sort working first, then finished newest first.
- The status item counts only working agents, not finished unseen ones.
- The sample data always has working agents in the two other parents, so the state with no
  working agent at all (no status item, no markers) is in the code but is not reachable on screen.
- Rows are fixed-height and titles are truncated with an ellipsis; the full title is in the
  tooltip.
- Hover closes after 250ms. The close delay, the 220px height cap and the order of the parent
  rows (working or agent-bearing sessions first, then unseen ones) are my choices.
- The submenu has no per-agent time. The owner called it optional and the data would be invented.
- Below about 455px of sidebar height on a phone (the fixed top of the sidebar, the list
  minimum, the grip and the area minimum) the sidebar clips its bottom. This happens in the
  preview only when the controls are expanded on a phone. The real app needs a rule for short
  screens.

### Not decided

Deleting, archiving or hiding a parent; whether agents can be archived or deleted from the area;
whether an agent's own children (nested agents) appear; folder filters; notifications for
finished agents; the server and browser contract. Implementation needs the owner's approval
first, and this mockup is not an approval.

## Requested sequencing

1. Review this working-agents mockup. Implement the approved first feature, then stop for the
   owner's verification.
2. Only afterwards, implement a separate resizable lower sidebar area listing all agents of the
   selected parent (working and finished), and exclude children from the main session list.
   Keep the parent selected/identifiable when visiting a child so sibling navigation remains
   available. Empty parents must not show an empty agents panel.

These are proposed navigation rules, not a change to running conversations. Parent-deletion
semantics still need a separate decision before implementing lifecycle changes; hiding children
from the main list must not accidentally leave their work inaccessible.
