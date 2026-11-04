# Caveman

`extensions/caveman` adds the Caveman voice. It is **off by default**.

The rules come from the installed `caveman` skill, normally
`~/.pi/agent/skills/caveman/SKILL.md`. Discovery uses `skillsFor(cwd)`, including Pi's configured agent
directory and project skill paths; the path is not hard-coded. The extension reads the skill body
on every prompt build, so edits show up on the next run without a bundled copy to drift.

The section opens with one line that says why it is on (this app's status bar, not the chat) and
that a phrase in a message which would switch it off in chat does not switch it here.

- **The switch** is a stone chip in the status bar's `end` slot, like keep-warm's, lit in
  `text-accent` when on and faded to `text-faint/60` when off. The popover holds one `Switch` and
  one line saying what the voice changes: every conversation you start, never a subagent.
- **The state** is one boolean for the whole app, `caveman.json` in the data
  directory, `{ "on": true }`; a missing, broken or non-boolean `on` means off. A failed save leaves
  the mode it had. The chip reads it when the conversation opens and again whenever the popover
  opens, because another tab or a phone runs the same switch; a token per reading means an answer
  that arrives late never overwrites a newer one or a toggle, a reading that starts while a save is
  running is dropped as stale, and every toggle re-reads once it is done so the switch settles on
  what the server stored. Nothing polls: a conversation whose first reading fails gets three bounded
  tries five seconds apart, so an unreachable server is not asked forever, and the chip appears only
  once a real state is known.
- **Caveman is parent-only.** A conversation that a tool started has an owner, and pi-durable's
  `createAgent()` copies the owner's agent, so the child inherits the parent's extension selection
  and would otherwise inherit the voice too. Caveman's owner comes from two places: the commits,
  through `onCommit` and `SessionRef.owner`, and the record itself, through `host.sessionOwner` —
  the immutable owner read from the conversation record. The commits alone are not enough: a new
  conversation's first commit is published after an asynchronous chain (`setImmediate`, the view
  opening, the cwd and owner lookups), while the harness builds a child's first request off
  microtasks, so the child would render the section before its baseline view arrived. Caveman
  therefore returns no section at all for a conversation with an owner, caches what the record
  answers (an `undefined` answer is a person's conversation too, and `Map.has` tells "asked and
  ownerless" from "never asked"), and asks nothing again for a conversation a commit already named.
- **The skill must exist.** The check runs at load time and throws, naming the skill, so the
  Extensions dialog says what is wrong instead of offering a switch that does nothing.
