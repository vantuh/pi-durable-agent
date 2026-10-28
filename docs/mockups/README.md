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
