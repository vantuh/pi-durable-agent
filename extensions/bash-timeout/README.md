# Bash timeout

`extensions/bash-timeout` puts two timers on every `bash` call, so a command that hangs cannot hold a
conversation, a subagent or a nested call forever: an **idle guard** keyed to progress, and a
**ceiling** keyed to wall clock. The idle guard catches the stuck command in seconds; the ceiling is
the backstop for one that prints forever without finishing.

The ceiling. A `beforeTool` hook sets the call's `timeout` (seconds) to the limit when the model gave
none, an invalid one or a longer one; a shorter one is kept. The hook runs before intent, so the
recorded call carries the limit.

- **Who stops it.** Pi-durable's `NodeExecutionEnv`: on timeout it kills the command's process group
  and the model gets `Command timed out after N seconds` with the output printed so far. The ceiling
  adds no timer of its own.
- **Whose clock it was.** pi's message gives the seconds but not whose: read plainly, an agent's
  shared limit is indistinguishable from a timeout the model chose. When the limit is what applied,
  `afterTool` adds one sentence to that message — the agent's shared bash limit (10 min), not a
  timeout it asked for; the command was killed, not finished; split it into smaller steps or narrow
  its scope. A timeout the model set for itself keeps pi's bare message, because that one really was
  its own.
- **Everyone hears about it.** A timeout the limit caused is said in every open browser tab, the
  home page included, as the session's own toast, the shape a finished run has: the session's
  title, `Bash timed out after 5 min · sleep 91; echo done · pi-durable-agent` under it, top-right
  for six seconds, a click opens that session. The tab showing the session now stays silent,
  because the red tool row is already there. A timeout the model asked for itself, being shorter
  than the limit, is the model's own choice and is not reported; neither is any other error.
  `beforeTool` records the whole decision — the limit in seconds, or that the model's own timeout
  stays — in the call's task, and `afterTool` reads that same answer back, so a resumed attempt
  cannot run on one timeout and be reported as another, and only the extension's own timeout counts.
- **The limit.** Whole minutes, 1 to 120, default 10, in `bash-timeout.json` in the data directory
  (`{ "minutes": 10 }`; a missing or broken file means the default). The row in the Extensions dialog
  expands (`details.tsx`) to the input. The file is read on every call, so a change applies to the
  next command; a command already running keeps the timeout it started with.

The idle guard. A wrap on the tool itself (`wrapTool`, `idleGuard`): if the command prints nothing,
on either stream, for `IDLE_SECONDS` (120, a constant in `refs.ts`, not a setting), the wrap cancels
a child of the call's context. `@earendil-works/chord`'s `withCancel` gives that child, so the
environment kills the command's process group and the caller's own Stop still reaches it.

- **It observes instead of rewriting.** The wrap proxies `api.output` to stamp the last activity and
  forwards the chunk and its `skipped` count unchanged, so the output window, the spill file and the
  retained tail stay pi's, and the model keeps whatever the command had already printed.
- **What the model reads.** One error diagnostic, code `bash_idle`: `No output for 120s, so the
  command was killed. Retry with a command that prints progress, or find out why it is silent.` The
  verdict travels in the result, so `afterTool` recognises it without a memo — which is also why the
  idle branch runs before the ceiling's memo check: a call the model gave its own shorter timeout is
  never touched by the ceiling, and the idle guard kills it anyway.
- **Everyone hears about it.** An idle kill is said in every open browser tab the way the ceiling's
  is: `Bash idle for 2 min · pnpm test · pi-durable-agent`, the same toast, the same suppression in
  the tab already showing that session. The wait is read back from the kill itself, so an
  `IDLE_SECONDS` edited below a minute is named in seconds instead of rounding to `0 min`.
- **What is left alone.** A normal end, the ceiling's timeout and the caller's abort are rethrown
  untouched. The environment reports a timeout ahead of an abort, so a command that hits both stays a
  timeout — the right precedence, and never two notices for one call. No opt-out: a per-call exception
  would turn "stuck" back into "ten minutes stuck".
- **No false alarm on Stop.** Only an abort while the caller's own signal is still live counts as a
  hang; pressing Stop is not reported.
- **The cost.** Output is an imperfect measure of progress: a step that is legitimately silent for two
  minutes — a buffered compile, a slow pull — is killed. The kill is recoverable, the model sees the
  output so far and is told why, and 120 s is deliberately generous. A command printing steadily while
  stuck satisfies the idle guard; only the ceiling stops that, which is why both timers stay.
