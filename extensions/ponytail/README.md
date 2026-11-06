# Ponytail

Adds the Ponytail voice: solve the task with the smallest change that fully works, and say so
shortly. It is **off by default**.

## Usage

A unicorn chip in the status bar's `end` slot, lit in `text-ok` when on and faded when off. Its
popover holds one switch and a line saying what the voice changes: every conversation, subagents
included.

## Configuration

- **State.** One boolean for the whole app, `ponytail.json` in the data directory,
  `{ "on": true }`. A missing, broken or non-boolean `on` means off. A failed save leaves the mode it
  had.
- **Rules.** They come from the installed `ponytail` skill, normally
  `~/.pi/agent/skills/ponytail/SKILL.md`, found through `skillsFor(cwd)`. The skill body is read on
  every prompt build, so edits show up on the next run. If the skill is missing, the load throws and
  names it.

## Behavior

- The prompt section opens with one line saying why it is on (this app's status bar, not the chat),
  that a phrase in a message which would switch it off in chat does not switch it here, and that the
  level is `full`, because there is no `/ponytail` command to pick `lite` or `ultra`.
- **The chip's state.** It reads the state when the conversation opens and whenever the popover
  opens, because another tab or a phone can flip the same switch. A token per reading keeps a late
  answer from overwriting a newer one or a toggle; every toggle re-reads once it is done. Nothing
  polls: a failed first reading gets three tries five seconds apart, and the chip appears only once
  a real state is known.
- **It reaches everyone.** There is no ownership check, so a subagent answers in the same voice as
  its parent.
- The unicorn (`web/icon.tsx`) is built with lucide's `createLucideIcon`. Its body is Tabler Icons'
  `horse` (MIT, Copyright (c) 2020-2026 Paweł Kuna, kept in the file); the horn is drawn here.
