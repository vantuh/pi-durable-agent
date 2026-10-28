# Pause

Holds a running conversation at its next step, and lets it go on — instead of stopping it and
asking again. Stop is destructive: the request in flight dies and a partial answer becomes an
aborted entry. Pause gives up nothing; it only declines to start the next step.

The button sits in the composer's row beside Stop, and appears only while the session runs: ⏸ to
hold, ▶ (yellow) to let go. The session's own menu in the sidebar carries the same command as one
item, so one conversation can be held while another is open on screen: it reads "Pause after this
step" while the session runs and turns into "Resume" once it is held. While a session is held, its
row shows a filled square in the warning colour instead of the working pulse, and says "Paused" to
a screen reader or on hover.

## Where a pause lands

A step is one model request or one tool call. A pause is decided at a step boundary, never inside
one:

| Pressed while                       | What happens                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| The model streams an answer         | The answer commits with its tool calls; the first call waits before it runs            |
| A tool runs                         | The tool finishes and commits its result; the next call or the next request then waits |
| The model composes its final answer | The answer commits, the run ends, and there was nothing left to hold                   |

So a long task stops on the first boundary after the button, not at its end. What a pause cannot do
is freeze a step in flight: a running child process or an open provider stream is not something a
hook can reach. Abort is the only way to cut one short.

A parallel tool round is the case to expect here: with the default `settings.toolExecution` every
call of a round starts together, so a pause pressed mid-round stops after the whole round, at the
next request.

## Steer and queue while held

A hold postpones the boundaries that place queued input, so the two queue modes wait differently.
Neither conflicts with a pause: the run is what stops, not the inbox.

- **Steer** waits in `pi.inbox`, shown as queued in the composer. On resume it is placed at the first
  boundary after the step under way — the post-tools one — so it joins the _next_ model request.
  The model may then follow it instead of the instruction it was on: a run told "Run `sleep 5`, then
  reply `first`" answered `steered.` after a steer was queued while it was held, and never said
  `first`. Expect the steer to redirect, not to be appended to the answer that was coming.
- **Queue** (`followUp`) is placed only at a run's `final` boundary. A hold keeps the run from
  ending, so a queued message waits until the pause is lifted _and_ the rest of the cycle finishes.
- **Stop on a held session drops the queue.** `Conversation.abort()` withdraws queued inputs (queued
  writes stay), so a message queued while parked and then stopped is gone. Withdraw one on purpose
  with `POST /api/queued/withdraw` instead; a pause does not block that.
- **Interrupt drops the pause too.** The abort ends the run, the run ending opens the gate, and the
  next message runs unpaused. Pause again if that is not what you wanted.

## How it works

- `gate.ts` — one `Gate` per conversation. `hold(context)` resolves at once while the gate is open
  and parks otherwise; `resume()` opens the gate and lets every parked call through; a parked call
  also resolves on its abort signal.
- `server.ts` — `ToolTask.beforeTool` holds the next call before it runs, `GenerationTask.beforeRequest`
  holds the next request before it leaves. Both await the conversation's gate, so nothing new
  begins, and no state is written while parked.
- `actions` — `pause`, `resume`, `toggle`, `state`, one call each through
  `POST /api/extensions/pause/actions/<name>` with `{ "session": n }`; each answers `{ paused }`.
  `toggle` is what the menu item calls, whichever way it reads.
- `web.tsx` — the composer item and the one menu item; the browser reads `state` on entering a
  session and whenever a run starts, and never guesses. The menu item's label and icon are
  functions of the row (`SessionSummary` in `sdk/types.ts`), which is how one item can say both.

## Things worth knowing before changing it

- **A pause is only taken while a run is in flight.** The `pause` action reads `running`, a map fed
  by commits; on an idle session it answers `{ paused: false }` and holds nothing. Without that
  check, a pause on an idle session holds the _first_ request of the next message, and that message
  waits with no visible reason (this is how it behaved before the check).
- **A parked call must be releasable by an abort.** `Gate.hold` listens to `context.abortSignal`, so
  Stop, a restart and a replaced task end the wait. A hook that ignores its signal would hang
  `Conversation.abort()` and the restart's graceful stop. `STOP_LIMIT_MS` in `server/main.ts` is the
  backstop for the process, not for the HTTP answer.
- **Every version must release its own parked calls.** `host.onDispose` opens all gates: saving this
  folder, turning it off, or deleting it leaves the old module's hooks parked on a map nobody can
  reach any more. Each load is a fresh module instance, so the new version starts with empty maps.
- **A finished run clears the pause.** `host.onCommit` opens the session's gate when `busy` goes
  false, so the next run starts unpaused. Nothing else clears it.
- **Nothing is durable here.** The gates and `running` live in the process: a restart resumes the
  work (its tasks come back as `pending`) and forgets the pause. That is the intended reading of
  "pause" — a live hold, not a stored state.
- **A held conversation still reads as busy.** `busy` stays true, `waitForIdle()` never resolves,
  the sidebar shows it working, and the composer queues what you type into `pi.inbox`. All correct
  for a frozen run, but anything that treats `busy` as "will finish soon" is wrong about a held one.
- **Subagents are not held.** Hooks resolve the conversation they run for, and a subagent's
  conversation has its own id, so a paused session's subagents keep going. Covering them means
  walking task ownership, not a bigger map.
- **`keep-warm` still warms a held session.** It sends requests outside the transcript, so a paused
  session can still spend a little on its provider cache. Extensions cannot import each other, so
  this is not something pause can switch off from here.
- **A restart while parked re-attempts the call.** `beforeTool` runs before the tool's intent is
  committed, so nothing about the call is durable yet; the task comes back and starts again from
  before intent. Safe for the calls the model makes, but a tool with external effects does not get
  an idempotency guarantee out of this.

## Checks

`gate.test.ts` covers the gate alone: park, open, release on abort, and that one conversation's
gate does not hold another's. The wiring was checked against a live Harness — the tool stays
`pending` and no process runs while held, a second session finishes untouched, and `/api/abort`
answers at once on a held session. `pnpm check` and `pnpm test` must pass.
