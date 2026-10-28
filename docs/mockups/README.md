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
[version 2](subagents-compact.html?count=3): the strip above the composer is kept, the sidebar
gains the area described in the sequencing below. The strip's own CSS is reused unchanged.

### What it shows

- **Main list: normal sessions only.** Agent conversations are not rows in it.
- **Agents area, under the list in the same column.** Titled "Agents of _<parent>_", with the total
  count. One row per agent, working first, then finished newest first. A working agent has the
  animated `.state-mark.working`; a finished one has the idle mark (or a green filled mark if it
  finished unseen). The secondary text is `working` or `finished 4m ago`.
- **Click a row** to open that agent's conversation in the main panel, with the "Back to <parent>"
  link above the composer, in the slot the strip used.
- **A parent with no agents** has no area, no handle, and no heading.
- **A child open:** its parent stays highlighted in the main list. The area still lists every
  sibling, and the open child is highlighted with a teal bar.
- **A child whose parent is missing** (archived here) is not hidden. It is a top-level row in the
  main list with an `agent` tag, and no agents area is shown unless decision B is switched on.
- **Resizing.** A grip between the list and the area drags the area's height. Keyboard on the
  focused grip: ArrowUp/ArrowDown change it by 16px (Shift: 64px), Home/End go to the minimum or
  maximum, Enter resets. Double-click resets. The size is stored in `localStorage` under
  `agents-area:height`. The grip turns yellow at a limit. The footer reads out the current area
  height, its bounds and the list height.
- **Narrow screens (below 1024px):** the sidebar is a drawer over the page, collapsed by default.
  The area stays under the list inside the drawer. Choosing a conversation closes the drawer,
  and the header shows a small "N working" hint next to the menu button so the work is not
  invisible while the drawer is closed.
- **Long list:** the 12-agent state scrolls inside the area's own bounds. Opening a child scrolls
  its row into view inside the area.

### Preview controls

Scenario (no agents, 3 agents, 12 agents, child open, parent missing), Sidebar (open or
collapsed), Theme (Mocha or Latte), and **Reset area size**. All of them, and the three decisions
below, are kept in the query string, for example
`?scenario=many&theme=latte&finished=check&totals=all&orphan=minimal&sidebar=open`. On a phone
the controls start collapsed; `?controls=1` opens them.

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

### Open decisions

Each can be switched in the preview. None is decided.

- **A. Children in the status-bar totals.** The status line shows "working" and "new" counts for
  other sessions. "Sessions only" counts main-list sessions. "+ agents" adds the agents of the
  open parent (the open child itself is never counted). With the agents area open the agents are
  already on screen, so counting them mostly matters when the sidebar is closed.
- **B. Parent not found.** "No area" shows nothing for an agent whose parent is missing.
  "Parent not found" shows a short fixed-height area saying so. The preview text says the parent
  is archived; the real wording depends on how deletion and archiving end up working.
- **C. A finished agent.** "Dimmed + time" shows a muted title and `finished 4m ago`. "✓ + context"
  shows a check mark (green if not yet viewed) and the final context percentage, amber above
  70%. Neither shows both.

### Behaviour chosen in the preview, not by the owner

- One stored area height is shared by every parent and by both desktop and phone. A height saved
  while looking at 12 agents leaves empty space under 3 agents.
- Agents sort working first, then finished newest first.
- Parent-missing demonstrates two agents with different states; the list sorts all top-level
  rows by recency.
- Rows are fixed-height and titles are truncated with an ellipsis; the full title is in the
  tooltip.
- Below about 455px of sidebar height on a phone (the fixed top of the sidebar, the list
  minimum, the grip and the area minimum) the sidebar clips its bottom. This happens in the
  preview only when the controls are expanded on a phone. The real app needs a rule for short
  screens.

### Not decided

Deleting, archiving or hiding a parent; whether agents can be archived or deleted from the area;
whether an agent's own children (nested agents) appear; folder filters beyond the one parent
case shown; notifications for finished agents; the server and browser contract. Implementation
needs the owner's approval first, and this mockup is not an approval.

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
