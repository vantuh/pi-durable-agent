# Pause

Holds a running conversation at its next step and lets it go on, instead of stopping it and asking
again. Stop is destructive: the request in flight dies and a partial answer becomes an aborted
entry. Pause gives up nothing; it only declines to start the next step.

## Usage

- A button in the composer's row beside Stop, shown only while the session runs: ⏸ to hold, ▶
  (yellow) to let go.
- The session's menu in the sidebar carries the same command as one item, so a conversation can be
  held while another is open. It reads "Pause after this step" while the session runs and "Resume"
  once it is held.
- A held session's row shows a filled square in the warning colour instead of the working pulse, and
  says "Paused" to a screen reader or on hover.
- Actions: `pause`, `resume`, `toggle`, `state`, each at `POST /api/extensions/pause/actions/<name>`
  with `{ "session": n }`, answering `{ paused }`. `toggle` is what the menu item calls.

## Behavior

A step is one model request or one tool call. A pause is decided at a step boundary, never inside
one:

| Pressed while                       | What happens                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| The model streams an answer         | The answer commits with its tool calls; the first call waits before it runs            |
| A tool runs                         | The tool finishes and commits its result; the next call or the next request then waits |
| The model composes its final answer | The answer commits, the run ends, and there was nothing left to hold                   |

With the default `settings.toolExecution` every call of a parallel round starts together, so a pause
pressed mid-round stops after the whole round, at the next request.

- **Steer** waits in `pi.inbox`, shown as queued. On resume it is placed at the first boundary after
  the step under way, so it joins the next model request and may redirect the run instead of being
  appended to the answer that was coming.
- **Queue** (`followUp`) is placed only at a run's `final` boundary. A hold keeps the run from ending,
  so a queued message waits until the pause is lifted and the rest of the cycle finishes.
- **Stop on a held session drops the queue** (`Conversation.abort()` withdraws queued inputs).
  Withdraw one on purpose with `POST /api/queued/withdraw`; a pause does not block that.
- **Interrupt drops the pause too.** The run ends, the gate opens, and the next message runs unpaused.
- **A finished run clears the pause.** `host.onCommit` opens the session's gate when `busy` goes false.
- **A held conversation still reads as busy:** `busy` stays true, `waitForIdle()` never resolves, the
  sidebar shows it working, and the composer queues what you type. `keep-warm` therefore starts no
  cache pings for it, though a ping already in flight is not cancelled.
- **Only a running session can be paused.** The `pause` action reads `running`, a map fed by commits;
  on an idle session it answers `{ paused: false }` and holds nothing. Otherwise the next message's
  first request would wait with no visible reason.

## Implementation notes

- `server/gate.ts`: one `Gate` per conversation. `hold(context)` resolves at once while the gate is
  open and parks otherwise; `resume()` opens it. A parked call also resolves on its abort signal, so
  Stop, a restart and a replaced task end the wait. A hook that ignored its signal would hang
  `Conversation.abort()` and the restart's graceful stop (`STOP_LIMIT_MS` in `server/main.ts` is the
  process's backstop).
- `server.ts`: `ToolTask.beforeTool` holds the next call before it runs and
  `GenerationTask.beforeRequest` holds the next request before it leaves. No state is written while
  parked.
- `host.onDispose` opens all gates, so saving, turning off or deleting the folder does not leave the
  old module's hooks parked on a map nobody can reach.
- `gate.test.ts` covers the gate alone: park, open, release on abort, and that one conversation's
  gate does not hold another's.

## Limits

- A pause cannot freeze a step in flight: a running child process or an open provider stream is out
  of a hook's reach. Abort is the only way to cut one short.
- Nothing is durable. The gates live in the process; a restart resumes the work and forgets the
  pause. A restart while parked re-attempts the call from before its intent is committed, so a tool
  with external effects gets no idempotency guarantee from this.
- Subagents are not held. A subagent's conversation has its own id, so a paused session's subagents
  keep going.
