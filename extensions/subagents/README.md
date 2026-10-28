# Subagents

Hand a self-contained task to another agent without blocking the conversation you are in. Each
agent has its own durable conversation, works with a named profile, and sends its answer back to
the conversation that started it. You can steer it, stop its current run, or continue it later
without losing its context.

This is the guide to the **current implementation**, not a list of promised features. For remaining
work and historical verification notes, see [HANDOFF.md](HANDOFF.md). The extension contract and
reload rules are in [docs/extensions.md](../../docs/extensions.md).

## Start here

1. Enable **Subagents** in Settings → Extensions (extensions are enabled by default).
2. Put a Markdown profile in `~/.pi/agent/agents/` or the project's `.pi/agents/`.
3. Ask the orchestrator to delegate a specific task using that profile.
4. Continue unrelated work, or let the orchestrator end its turn. The report arrives automatically.
5. Expand the report to read it, or use its open-conversation link to inspect the agent's work.

The **orchestrator** is the agent in the parent conversation. The **profile** is a reusable set of
instructions, a required model, and optional thinking/tool choices. The **agent name** identifies
one child conversation within that parent; it is what `agent_send`, `agent_stop`, and `agent_status`
address.

For example, save this as `.pi/agents/reviewer.md`:

```md
---
name: reviewer
description: Read specified files and report concrete defects without editing.
tools: read
model: openai/gpt-6.1-sol
thinking: medium
---

Review only the files named in your task. Do not change files.
Report concrete defects with file paths, evidence, and their impact.
If the allowed tools cannot establish a claim, say what you could not verify.
```

Set `model` to an exact available model ID for your installation; the example is not automatically
mapped to another provider. Missing or unavailable models fail the spawn instead of inheriting the
parent's model.

The orchestrator can then make these tool calls. They are JSON arguments to the named tools, not
HTTP endpoints or commands to paste into a terminal:

```text
agent_spawn({
  "agent": "reviewer",
  "name": "Review",
  "task": "Review extensions/subagents/server.ts for duplicate report delivery. Read-only. Report concrete defects with evidence; do not edit or run commands."
})

agent_send({
  "name": "Review",
  "message": "Also check what happens when a steering message joins a run already in progress."
})

agent_stop({ "name": "Review" })

agent_send({
  "name": "Review",
  "message": "Continue the review using the context you already have."
})
```

`agent_send` is a correction while the agent is working, or a follow-up after it finishes. It is
not necessary to resend the original task. Use `agent_status({ "name": "Review" })` only when the
user asks or a decision requires it, not to poll until the work finishes.

## The four tools

All four tools operate on agents started by the **current parent conversation**. Another parent
can have an agent with the same name; names are not process-wide identifiers. Names and profile
names are case-sensitive; leading and trailing whitespace in tool arguments is trimmed.

| Tool           | Arguments                                                | Effect                                                                                                           |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `agent_spawn`  | `agent: string`, `task: string`, optional `name: string` | Creates a child conversation and schedules the task. Returns after scheduling, not after the answer.             |
| `agent_send`   | `name: string`, `message: string`                        | Submits a steering message to a working child, or starts another run in an idle child with its previous context. |
| `agent_stop`   | `name: string`                                           | Aborts that child's current run. Keeps the conversation and its name for a later send.                           |
| `agent_status` | Optional `name: string`                                  | Lists agents and their working/idle state, or returns one agent's state and latest text preview. Read-only.      |

### Spawn and naming

- Only `agent`, `task`, and optional `name` are accepted. Extra arguments, including `model`,
  `thinking`, and `thinkingLevel`, fail schema validation even if they match the profile's values.
  The orchestrator must choose an existing Markdown profile, not construct or override one inline.
- `agent` must match a profile's frontmatter `name`, not necessarily its filename.
- An empty task or an unknown profile returns a tool error. An unknown-profile error lists the
  available profile names.
- Without a non-empty explicit name, the extension title-cases the profile name: `code-reviewer`
  becomes `Code Reviewer`. If that name is taken, it uses `Code Reviewer #2`, then `#3`, and so on.
- An explicit name already in use returns an error rather than replacing the agent. Use
  `agent_send` to continue it, or choose another name for a fresh context.
- The sidebar title is `<Name>: <task>`, with whitespace collapsed and the task cut to 60
  characters. Renaming the session in the UI does not change the name used by the tools.

### Send and status

- A send uses `whenBusy: "steer"`: it joins the working run at the next applicable boundary,
  rather than interrupting the provider request immediately. If idle, the child starts a new run.
- A successful send clears the flag set by `agent_stop`.
- Without `name`, status lists every agent this parent has ever started, including idle ones.
- With `name`, status scans the newest 20 entries of the child's conversation for non-empty
  assistant text, then keeps at most its last 2000 characters. This may be partial/intermediate
  text, not a final result; the tool labels it as a preview. It can find nothing if the newest 20
  entries contain no assistant text.
- There is **no `full` parameter** today. Open the child conversation to inspect the full answer.
- Working means `pi.live.run` exists. Idle does not distinguish success, failure, and a stopped
  run. Inspect the report or transcript for the outcome.

## Profiles: discovery and precedence

Profiles are read from disk when the orchestrator's `agents` prompt section is built and when
`agent_spawn` runs. No restart is needed for a profile edit. Changes affect future spawns, not
agents already created; `agent_send` does not read or reapply the profile.

The lookup order is:

1. `<agent directory>/agents/*.md`. The agent directory comes from Pi's `getAgentDir()`:
   normally `~/.pi/agent`, or the directory selected by `PI_CODING_AGENT_DIR`.
2. The **nearest** `.pi/agents/` directory, searching from the parent conversation's working
   directory upward to the filesystem root. Its profiles replace user profiles with the same
   frontmatter `name`.

Only one project directory is used. If `<cwd>/.pi/agents/` exists but is empty, an ancestor's
`.pi/agents/` is not also read. If the conversation has no working directory, lookup starts at
`host.cwd` (the directory the app was started in).

Within each directory, only direct files ending in `.md` are read, in sorted filename order; no
recursive scan. If two files declare the same name, the later filename wins. Missing/unreadable
directories, unreadable files, parsing failures, and profiles missing required fields are silently
skipped; they do not prevent other profiles from loading.

### Frontmatter

| Field         | Required      | Current meaning                                                                                         |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `name`        | Yes           | Non-empty string used to select the profile and stored with the agent.                                  |
| `description` | Yes           | Non-empty string shown with the name in the orchestrator's profile list.                                |
| `tools`       | No            | Comma-separated names or a YAML list; an allowlist intersected with the parent's tools.                 |
| `model`       | Yes, at spawn | Exact `provider/modelId`; must be available and authenticated.                                          |
| `thinking`    | No            | Supported string level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; omitted means `off`. |

The Markdown body becomes the child's instructions followed by the extension's agent protocol.
Unknown frontmatter fields are ignored. In particular, `skills` does not select skills, and
`system-prompt: replace` does not replace the system prompt.

The tool list can also be written as:

```yaml
tools:
    - read
    - bash
```

Important details:

- Absent, empty, or unusable `tools` keeps the parent's tool set, except this extension's own
  tools. An empty list does **not** mean "no tools".
- With a non-empty list, only tools the parent actually has survive. Unknown names are silently
  dropped; a list containing only unknown names can leave the child with no tools.
- `model` is required at spawn. The provider and model ID must match exactly; there is no fuzzy
  matching, provider mapping, or fallback to the parent's model.
- A missing, malformed, unknown, or unauthenticated model returns a tool error before creating
  any child conversation or background task. The error identifies the profile and problem; an
  unavailable-model error lists the available IDs for that provider (or says none).
- Model availability is checked with `api.models.getAvailable(provider)`, including authentication,
  not just catalog membership. Fix the Markdown profile, provider registration, or authentication;
  do not work around an error by passing a model override.
- Omitted `thinking` explicitly means `off`, independent of the parent's level. A supplied value
  must be a supported string level for that model; invalid values (including null/numbers) and
  unsupported levels fail the spawn. There is no automatic clamping to a different level.
- Missing-model profiles stay discoverable so spawn can explain the invalid frontmatter rather
  than reporting an unknown profile. The report header still omits the actual model; inspect the
  child's model/statistics if needed. A successful spawn is not proof that a later provider request
  will succeed.

## What the child inherits, and what it does not

The harness starts a task-owned child with the parent's agent configuration, including extensions,
tools, and working directory. Before creating it, the extension validates the profile's required
model and thinking (`off` when omitted). It then explicitly sets both, along with the profile's
instructions and optional tool allowlist. The parent's model and thinking are never used as fallbacks.

**The parent's transcript is not the child's context.** Every task must include the goal, scope,
relevant paths, constraints, expected output, and whether edits are permitted. Include the check to
run for an implementation task. A follow-up through `agent_send` keeps the child's own context.

Other installed prompt sections still apply: project instructions and, when the tools permit
reading them, skills. The profile body does not replace those sections. The `subagents` extension
itself is removed from the child by name, so the child has neither these four tools nor the
orchestrator's `agents` prompt section. Recursive delegation is not supported.

**This is not a sandbox or a separate worktree.** A child uses the same working directory and
machine permissions. Multiple editing agents can overwrite one another's work. Delegate edits only
to disjoint file sets; a tool allowlist is not a filesystem permission boundary (`bash`, for
example, can write files). The prompt recommends at most four independent agents in parallel;
that is guidance to the model, not an enforced concurrency limit.

The appended protocol asks the child to keep progress short, return a complete text answer, and
end with `AGENT_RESULT: done | blocked — <summary>`. If blocked on a question, it should end its
turn with that question; the parent can answer via `agent_send`. The marker is an instruction,
not a parsed status field or a separate question-delivery channel.

## Reports and the screen

When a child's submitted input settles with an answer, the reporter extracts the answer entry's
text blocks, joins and trims them, and sends them to the parent as input:

```text
[agent Review (reviewer) finished]

<the child's answer>
```

No text blocks means `(no text)`. The header says the submission produced an answer; it does not
prove that the task succeeded or that the answer's claims were checked. The parent should verify
important claims and summarize the outcome for the person.

Reports use `whenBusy: "steer"`: they join the parent's current run at its next boundary, or
start a run if the parent is idle. They are not a synchronous return value of `agent_spawn`.
A missing child conversation produces a failure report, as does an unanswered submission unless
`agent_stop` has set the suppression flag.

### Model input versus displayed text

Each submission has separate model content and application entry data:

| Direction      | Entry kind              | `data.author`  | `data.session`         | `data.text`                            |
| -------------- | ----------------------- | -------------- | ---------------------- | -------------------------------------- |
| Parent → child | `subagents.instruction` | `Orchestrator` | Parent conversation ID | Task or follow-up text                 |
| Child → parent | `subagents.report`      | Agent name     | Child conversation ID  | Answer text, without the report header |

The model reads the submission's `content`. The UI prefers `data.text`, so the parent sees the
report header in its model context while the person sees the answer under the agent's name.
**Reports are not length-limited today:** the full text enters both the parent's context and the
report card. Folding the card saves screen space, not context tokens.

Core projects an application entry with a user-role model message and a non-empty string
`data.author` as a user entry with an author. The optional numeric `data.session` supplies its
open-conversation link. This is a generic convention, not a core dependency on this extension;
see [the server contract](../../docs/server.md#messages-from-application-authors).

The transcript draws authored messages as left-hand cards with an agent-coloured stripe, bot icon,
name, and a first-line preview. They are folded by default; expand to read Markdown. The open link
navigates to the source conversation (an ordinary link also works in a new tab).

While a report or instruction is queued, the composer shows its author and mode using the same
agent styling. It can be withdrawn, but not edited and resent as the person's own message.
Withdrawing a queued report does not cause the reporter to send it again.

`web.tsx` registers the bot icon for all four `agent_*` tools in the activity timeline. It adds
no panel, settings controls, or agents count in the status bar.

### Working-agents strip

Above the composer, in the `aboveComposer` slot, one horizontal line shows the agents the open
conversation started that are working now. With none working, nothing is drawn, not even an empty
row. Each chip is a link to the agent's conversation: the animated working mark, the agent's name,
its model (the id without the provider, in small faint text, cut at 84px), and a context bar with a
percentage. The bar turns `warn` above 70%. The full model with its provider, the profile and the
exact token counts are in the hover title. There is no speed figure.

- The line scrolls sideways when the chips do not fit. Chips are 36px tall, 40px under 760px wide.
- The percentage is an estimate like the context meter's: the agent's latest answer (input, output,
  cache read and write) over the model's context window. Before its first answer the chip shows a dash.
- When the open conversation is itself an agent's, the strip is replaced by one link,
  "← Back to <parent title>", with the same outer height, so the composer does not move between the
  two views. A plain click opens the conversation in the app; a modified click opens a new tab.
- The `strip` action (`refs.ts`) feeds it. Which conversations are agents comes from the core's
  owner link (`session.owner` in a commit view and in an action call), not from any entry: an agent
  started before its instruction recorded `agent` and `profile` still has its parent. "Working" is
  the commit's busy flag, and the latest answer gives the context fill. The name is the
  instruction's `agent` field; without one, the part of the session name before the first `": "` (the
  title set at spawn is `<Name>: <task>`); without that, "Agent". A profile the instruction did not
  record leaves the profile and the model blank until the first answer.
- Every commit of an agent calls `host.notifySessionChanged(parent)`. The core sends the parent's
  browsers a new `session.revision` at most every 250 ms, and the strip asks again when it moves, so
  an agent appears, fills and disappears without the person touching the page. Nothing polls.
- The lower sidebar area with all agents, finished ones included, is not built; see
  [HANDOFF.md](HANDOFF.md).

## Stop, direct messages, archive, and delete

| Action                          | What happens now                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop in the parent conversation | Aborts the parent's foreground run, not its background agent/reporter tasks. Agents keep working. A later report may start the parent again.                           |
| `agent_stop` in the parent      | Sets the child's suppression flag, then aborts its current run. An unanswered submission under that flag produces no report. Context remains for `agent_send`.         |
| Stop an already idle agent      | Returns that nothing was running; still sets the suppression flag until the next `agent_send`.                                                                         |
| Stop directly in the child's UI | Aborts the child without setting the extension's suppression flag. A waiting reporter can therefore send a failure report.                                             |
| Type directly into the child    | Runs there, but creates no new reporter, so there is no automatic report for that direct submission.                                                                   |
| Archive a session               | Changes sidebar visibility only; it does not stop the session or its children.                                                                                         |
| Delete the parent               | Marks the parent deleted and aborts its foreground run. Its background agents are not explicitly stopped by the current delete path. Do not use deletion to stop them. |
| Delete a child                  | Marks it deleted for the core list/open API; it does not remove the parent's agent record. `agent_send` still addresses the durable conversation through the harness.  |

Stopping is not a recall: an answer already settled or a report already submitted may still arrive.
If a parent is deleted with agents working, their background work may continue; stop them first.
Deleting is not a purge of stored entries. See [session-delete.md](../../docs/session-delete.md).

Child sessions currently appear as ordinary top-level rows in the session list, not nested under
their parents. Agent records have no close/remove operation. Finished agents remain addressable,
and the parent's no-name status list grows as more are spawned.

## Implementation and durability

The pattern comes from Pi Durable's README, “Abort and Subagents”, example 23. The example file is
not shipped with the installed package; the README text is the reference. No custom agent loop or
child process is created here.

### File map

| File             | Responsibility                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| `profiles.ts`    | Profile discovery, frontmatter parsing, and precedence.                                 |
| `server.ts`      | Four tools, `agents` prompt section, durable agent document, anchor and reporter tasks. |
| `refs.ts`        | The `strip` action ref and its result type, shared by `server.ts` and `web.tsx`.        |
| `web.tsx`        | Bot icons and the working-agents strip above the composer.                              |
| `server.test.ts` | Real-Harness integration tests with a faux model and disposable SQLite storage.         |
| `README.md`      | Current usage, behavior, constraints, and maintenance guide.                            |
| `HANDOFF.md`     | Remaining proposals and historical implementation/verification context.                 |

### Parent document

`subagents.agents`, version 1, is a conversation-scoped document. Its shape is:

```text
{
  agents: {
    [name]: {
      conversationId,  // child's durable conversation ID
      agent,           // profile name, not the child's current model
      callId,          // last spawn/send tool call that scheduled work
      reported,        // answer entry IDs already reported
      stopped          // suppress unanswered results after agent_stop
    }
  }
}
```

State lives in the harness, not in a module-level map or a results directory. `reported` currently
grows by one ID per answer selected for reporting, without pruning. Profiles are files, but the full
answers are already stored as entries in the child's conversation; the extension writes no separate
report files.

### Anchor and reporter tasks

1. **Spawn transaction:** find a replayed `callId` or choose a free name; create a background
   `subagents.anchor` task owned by the parent; create the child owned by that anchor; configure
   it; save its record; create a background `subagents.reporter` task owned by the parent.
2. **Anchor:** ends immediately. Its ownership establishes the background boundary that prevents
   the parent's normal abort from reaching the child. It is not a worker loop.
3. **Reporter, `deliver`:** submit the instruction to the child with
   `requestId: subagents:<reporter task ID>` and wait for that submission to settle.
4. **Checkpoint transaction:** consult `stopped` for an unanswered submission; for an answer,
   suppress a duplicate `reported` ID or append it and save the report text in the task checkpoint.
5. **Reporter, `report`:** submit the saved report to the parent with
   `requestId: subagents-report:<reporter task ID>`, then end the reporter task.

`agent_send` schedules another reporter against the same child, unless its `callId` is the one
already stored. A steering submission can settle with the same answer as the run it joined, so
multiple reporters may observe one answer; the transaction's `reported` check lets only one
prepare that report.

Both tools declare `replay: "safe"`; `callId` guards scheduling, request IDs guard duplicate
submissions, and the report checkpoint lets the second phase resume without asking the child
again. Keep these protections when changing the tasks. They protect extension delivery across
replay/restart, not arbitrary external effects of a child's tools. Running work is durable and can
resume when the server reopens its state with the extension installed.

### Reloading

- Profile edit: picked up on the next prompt build/spawn; existing children keep their configuration.
- `server.ts` or a helper it imports from this folder: the loader reinstalls the extension on save;
  an already-running tool call finishes on its old version. A broken replacement keeps the last
  working version. Do not casually change task phases, checkpoint shapes, or document versions:
  stored work may still use them.
- `web.tsx`: Vite HMR in development. Production needs `pnpm build` and a page refresh to use the
  new browser bundle; a server restart alone does not rebuild it.
- Core projection/protocol/UI changes: follow the core reload rules. Server changes need a server
  restart; production browser changes need a rebuild. An old server without the author convention
  hides application report entries instead of drawing the cards.

Do not assume turning the extension off is a stop-all command: it has no explicit cleanup that
walks its agents and aborts them. Use `agent_stop` for agents you intend to stop before disabling.

## Verification and safe local work

Run from the repository root:

```bash
node --test extensions/subagents/
pnpm check
pnpm test
```

The extension tests use a real `Harness`, real task scheduling, and a temporary SQLite file.
A faux model distinguishes parent and child by `## Agent protocol` in the child's system messages.
They check:

- Spawn creates a separate conversation, applies instructions and the tool allowlist, removes the
  subagents extension, sets the title, and delivers the report with author/source metadata in
  both directions. A follow-up keeps the child's original model/thinking even after the profile
  file is edited.
- Unknown profiles, missing/malformed/unavailable/unauthenticated models, invalid or unsupported
  thinking, and inline model/thinking overrides return tool errors without creating a child.
- Omitted thinking becomes `off` even when the parent uses `high`.
- `agent_stop` aborts a working child without reporting its unanswered run to the parent.

The tests set `PI_CODING_AGENT_DIR` to a temporary directory so the owner's profiles do not leak
in. A scripted faux tool call must use `stopReason: "toolUse"`; otherwise the harness treats it as
an answer. The current suite does **not** establish exhaustive profile parsing, restart/replay,
steering-race, or browser behavior coverage. Projection tests in
[`test/projection.test.ts`](../../test/projection.test.ts) separately cover authored entries and
queued messages.

For manual testing, use a disposable `PI_DURABLE_DATA_DIR` and a free `PORT`, never the running
app's `data/state.sqlite` or its port. Disable unrelated extensions in that temporary data folder
before startup; a new data directory otherwise enables them by default and they may make network
requests. A Vite instance must proxy `/api` to that test server, not the owner's server.
[HANDOFF.md](HANDOFF.md#seeing-the-ui-without-touching-the-owners-app) records the isolated UI
setup. A successful test run is not evidence that the owner's production bundle has been rebuilt.

## Troubleshooting and known limits

| Symptom                                                 | Check                                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile missing from the prompt / unknown profile error | Required `name` and `description`, readable `.md` file, the session's cwd, nearest project-directory precedence, and `PI_CODING_AGENT_DIR`. Invalid profiles are skipped silently.      |
| Spawn rejects a profile's model or thinking             | Read the tool error and fix the Markdown profile or provider/auth setup. `model` is required; thinking must be supported (`off` when omitted). There is no fallback or inline override. |
| Child has too many or too few tools                     | Empty lists inherit; non-empty lists intersect exact parent tool names. Editing the profile does not reconfigure an existing child.                                                     |
| Spawn says the name exists                              | Continue it with `agent_send`, or choose a fresh name; session titles and tool names are separate.                                                                                      |
| No report after typing in the child                     | Direct input creates no reporter. Send through the parent when a report is required.                                                                                                    |
| No report after `agent_stop`                            | An unanswered stopped run is intentionally suppressed. Continue with `agent_send`.                                                                                                      |
| Report exists but is invisible in the UI                | Check for an old server without author projection, an old browser build, or a report still queued at a boundary.                                                                        |
| Parent starts again after Stop                          | Its background agents/reporters outlive a foreground stop. Stop the specific agents too if that is the intent.                                                                          |
| Status preview is stale, cut, or empty                  | It reads assistant text from only the newest 20 entries and keeps the last 2000 characters. Open the child transcript.                                                                  |
| Many sidebar rows or a large parent context             | Nesting child sessions and bounding reports are still open items, not implemented behavior.                                                                                             |

Deliberately absent: recursive agents, an `ask_question` tool, a full-result status option, model
mapping, isolated worktrees, and a status-bar agent count. Questions travel as ordinary final
answers; the parent answers with `agent_send`. The remaining proposals are in
[HANDOFF.md](HANDOFF.md#open-items-in-recommended-order).
