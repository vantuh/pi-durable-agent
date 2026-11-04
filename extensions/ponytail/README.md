# Ponytail

`extensions/ponytail` adds the Ponytail voice. It is **off by default**.

The rules come from the installed `ponytail` skill, normally
`~/.pi/agent/skills/ponytail/SKILL.md`. Discovery uses `skillsFor(cwd)`, including Pi's configured agent
directory and project skill paths; the path is not hard-coded. The extension reads the skill body
on every prompt build, so edits show up on the next run without a bundled copy to drift.

The section opens with one line that says why it is on (this app's status bar, not the chat) and
that a phrase in a message which would switch it off in chat does not switch it here. The line adds
that the level is `full`, because lite and ultra are levels a `/ponytail` argument picks and there
is no `/ponytail` command here.

- **The switch** is a unicorn chip in the status bar's `end` slot, like keep-warm's, lit in
  `text-ok` when on and faded to `text-faint/60` when off. The popover holds one `Switch` and one
  line saying what the voice changes: every conversation, subagents included.
- **The unicorn** is `ponytail/icon.tsx`, built with lucide's `createLucideIcon` so it carries the
  same grid, stroke and props as every other chip. Lucide has no horse: the body is Tabler Icons'
  `horse` (MIT, Copyright (c) 2020-2026 Paweł Kuna, kept in the file), the horn and its notch are
  drawn here, and the result was checked at the chip's 14 px.
- **The state** is one boolean for the whole app, `ponytail.json` in the data
  directory, `{ "on": true }`; a missing, broken or non-boolean `on` means off. A failed save leaves
  the mode it had. The chip reads it when the conversation opens and again whenever the popover
  opens, because another tab or a phone runs the same switch; a token per reading means an answer
  that arrives late never overwrites a newer one or a toggle, a reading that starts while a save is
  running is dropped as stale, and every toggle re-reads once it is done so the switch settles on
  what the server stored. Nothing polls: a conversation whose first reading fails gets three bounded
  tries five seconds apart, so an unreachable server is not asked forever, and the chip appears only
  once a real state is known.
- **Ponytail reaches everyone.** It keeps no ownership machinery: no commit listener, no record
  read, no owner check. A subagent answers in the same voice its parent does, deliberately — the
  lazy-senior rules are as useful inside a worker as at the top, and the smallest change that works
  is exactly what a child is for.
- **The skill must exist.** The check runs at load time and throws, naming the skill, so the
  Extensions dialog says what is wrong instead of offering a switch that does nothing.
