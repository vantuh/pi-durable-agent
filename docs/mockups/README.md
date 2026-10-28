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

## Step 1: proposed working-agents area

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
