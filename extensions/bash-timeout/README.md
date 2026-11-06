# Bash timeout

Puts two timers on every `bash` call, so a command that hangs cannot hold a conversation, a
subagent or a nested call forever: an **idle guard** keyed to progress, and a **ceiling** keyed to
wall clock. The idle guard catches a stuck command in seconds; the ceiling is the backstop for one
that prints forever without finishing.

## Usage

The Extensions dialog row expands (`details.tsx`) to an input for the ceiling. When either timer
kills a command, every open browser tab shows a toast in the shape a finished run has: the session's
title, then `Bash timed out after 5 min · sleep 91; echo done · pi-durable-agent` or
`Bash idle for 2 min · pnpm test · pi-durable-agent`, top-right for six seconds. A click opens that
session. The tab already showing the session stays silent, because the red tool row is there.

## Configuration

The ceiling is whole minutes, 1 to 120, default 10, in `bash-timeout.json` in the data directory
(`{ "minutes": 10 }`; a missing or broken file means the default). The file is read on every call, so
a change applies to the next command; a command already running keeps the timeout it started with.

The idle limit is `IDLE_SECONDS` (120) in `refs.ts`, not a setting.

## Behavior

**Ceiling.** A `beforeTool` hook sets the call's `timeout` (seconds) to the limit when the model gave
none, an invalid one or a longer one; a shorter one is kept.

- Pi-durable's `NodeExecutionEnv` stops the command: on timeout it kills the process group and the
  model gets `Command timed out after N seconds` with the output printed so far.
- When the limit is what applied, `afterTool` adds a sentence saying it was the agent's shared bash
  limit, not a timeout the model asked for, that the command was killed, and to split it into smaller
  steps. A timeout the model set for itself keeps pi's bare message and is not reported.
- `beforeTool` records the decision in the call's task and `afterTool` reads it back, so a resumed
  attempt cannot run on one timeout and be reported as another.

**Idle guard.** A wrap on the tool (`wrapTool`, `idleGuard`): if the command prints nothing on either
stream for `IDLE_SECONDS`, the wrap cancels a child of the call's context (`withCancel` from
`@earendil-works/chord`). The environment kills the command's process group, and the caller's own
Stop still reaches it.

- The wrap proxies `api.output` to stamp the last activity and forwards each chunk unchanged, so the
  output window, spill file and retained tail stay pi's.
- The model reads one error diagnostic, code `bash_idle`: `No output for 120s, so the command was
  killed. Retry with a command that prints progress, or find out why it is silent.`
- The idle branch runs before the ceiling's memo check, so a call with the model's own shorter
  timeout is still killed by the idle guard.
- A normal end, the ceiling's timeout and the caller's abort are rethrown untouched. A command that
  hits both a timeout and an abort stays a timeout, and never produces two notices. Pressing Stop is
  not reported as a hang.

## Limits

- Output is an imperfect measure of progress: a step that is legitimately silent for two minutes (a
  buffered compile, a slow pull) is killed. The model sees the output so far and is told why.
- A command printing steadily while stuck satisfies the idle guard; only the ceiling stops it.
- There is no per-call opt-out.
