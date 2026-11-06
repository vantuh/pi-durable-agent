# Caveman

Adds the Caveman voice: terse replies with every technical fact kept. It is **off by default**.

## Usage

A stone chip in the status bar's `end` slot, lit in `text-accent` when on and faded when off. Its
popover holds one switch and a line saying what the voice changes: every conversation you start,
never a subagent.

## Configuration

- **State.** One boolean for the whole app, `caveman.json` in the data directory, `{ "on": true }`. A
  missing, broken or non-boolean `on` means off. A failed save leaves the mode it had.
- **Rules.** They come from the installed `caveman` skill, normally
  `~/.pi/agent/skills/caveman/SKILL.md`, found through `skillsFor(cwd)` (so Pi's configured agent
  directory and project skill paths apply). The skill body is read on every prompt build, so edits
  show up on the next run. If the skill is missing, the load throws and names it, so the Extensions
  dialog says what is wrong instead of offering a switch that does nothing.

## Behavior

- The prompt section opens with one line saying why it is on (this app's status bar, not the chat)
  and that a phrase in a message which would switch it off in chat does not switch it here.
- **The chip's state.** It reads the state when the conversation opens and whenever the popover
  opens, because another tab or a phone can flip the same switch. A token per reading keeps a late
  answer from overwriting a newer one or a toggle; every toggle re-reads once it is done. Nothing
  polls: a failed first reading gets three tries five seconds apart, and the chip appears only once
  a real state is known.
- **Parent only.** A conversation that a tool started has an owner, and pi-durable's `createAgent()`
  copies the owner's extension selection, so a child would inherit the voice. Caveman returns no
  section for a conversation with an owner. The owner comes from commits (`onCommit`,
  `SessionRef.owner`) and from the record (`host.sessionOwner`). Commits alone are not enough: a new
  conversation's first commit is published after an asynchronous chain, while the harness builds a
  child's first request earlier. Answers from the record are cached, including "no owner".
