# Subagents

Hand a self-contained task to another agent without blocking the conversation you are in. Each agent
has its own durable conversation, works with a named profile, and sends its answer back to the
conversation that started it. You can steer it, stop its current run, or continue it later without
losing its context. The extension contract and reload rules are in
[docs/extensions.md](../../docs/extensions.md).

## Usage

The **orchestrator** is the agent in the parent conversation. The **profile** is a reusable set of
instructions, a required model, and optional thinking and tool choices. The **agent name** identifies
one child conversation within that parent; `agent_send`, `agent_stop` and `agent_status` address it.

1. Put a Markdown profile in `~/.pi/agent/agents/` or the project's `.pi/agents/`.
2. Ask the orchestrator to delegate a specific task using that profile.
3. Continue unrelated work, or let the orchestrator end its turn. The report arrives automatically.
4. Expand the report to read it, or use its open-conversation link to inspect the agent's work.

Example `.pi/agents/reviewer.md`:

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

Set `model` to an exact available model ID for your installation. A missing or unavailable model
fails the spawn instead of inheriting the parent's model.

### The four tools

The orchestrator calls these tools (JSON arguments, not HTTP endpoints). All four operate on agents
started by the **current parent conversation**; another parent can have an agent with the same name.
Names and profile names are case-sensitive, and leading and trailing whitespace in arguments is
trimmed.

| Tool           | Arguments                                                                  | Effect                                                                                                                        |
| -------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `agent_spawn`  | `agent: string`, `task: string`, optional `name: string` and `cwd: string` | Creates a child conversation and schedules the task. Returns after scheduling, not after the answer.                          |
| `agent_send`   | `name: string`, `message: string`                                          | Submits a steering message to a working child, or starts another run in an idle child with its previous context.              |
| `agent_stop`   | `name: string`                                                             | Aborts that child's current run and cancels messages not yet delivered. Keeps the conversation and its name for a later send. |
| `agent_status` | Optional `name: string`                                                    | Lists agents and their working/idle state, or returns one agent's state and latest text preview. Read-only.                   |

**Spawn and naming**

- Only `agent`, `task`, `name` and `cwd` are accepted. Extra arguments, including `model`, `thinking`
  and `thinkingLevel`, fail schema validation even if they match the profile. The orchestrator picks
  an existing profile; it cannot build or override one inline.
- `cwd` must be an absolute path to an existing directory. Omitted, empty or whitespace-only means the
  parent's working directory. It changes the child's folder, not where profiles are discovered.
- `agent` must match a profile's frontmatter `name`, not necessarily its filename. An empty task or an
  unknown profile returns a tool error; the unknown-profile error lists the available names.
- Without an explicit name, the profile name is title-cased (`code-reviewer` becomes `Code Reviewer`),
  then `Code Reviewer #2`, `#3` and so on when taken. An explicit name already in use returns an error
  rather than replacing the agent.
- The sidebar title is `<Name>: <task>`, whitespace collapsed and the task cut to 60 characters.
  Renaming the session in the UI does not change the name the tools use.

**Send and status**

- A send uses `whenBusy: "steer"`: it joins the working run at the next applicable boundary, or starts
  a new run if the child is idle. A successful send clears the flag set by `agent_stop`.
- Without `name`, status lists every agent this parent has ever started, idle ones included.
- With `name`, status scans the newest 20 entries of the child's conversation for non-empty assistant
  text and keeps at most its last 2000 characters, labelled as a preview. It may be partial text and
  can be empty. There is no `full` parameter; open the child conversation for the full answer.
- "Working" means `pi.live.run` exists. Idle does not distinguish success, failure and a stopped run.

## Configuration

### Profiles

Profiles are read from disk when the orchestrator's `agents` prompt section is built and when
`agent_spawn` runs, so an edit needs no restart. It affects future spawns, not existing agents;
`agent_send` does not reapply the profile. The lookup order:

1. `<agent directory>/agents/*.md`. The agent directory is Pi's `getAgentDir()`: normally
   `~/.pi/agent`, or `PI_CODING_AGENT_DIR`.
2. The **nearest** `.pi/agents/` directory, searching from the parent conversation's working
   directory up to the filesystem root. Its profiles replace user profiles with the same `name`.

Only one project directory is used: an empty `<cwd>/.pi/agents/` does not fall through to an
ancestor's. With no working directory, lookup starts at `host.cwd`. Only direct `.md` files are read,
in sorted filename order, with no recursive scan; of two files with the same name the later wins.
Unreadable directories or files, parse failures and profiles missing required fields are silently
skipped.

| Field           | Required      | Meaning                                                                                                 |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `name`          | Yes           | Non-empty string used to select the profile and stored with the agent.                                  |
| `description`   | Yes           | Non-empty string shown with the name in the orchestrator's profile list.                                |
| `tools`         | No            | Comma-separated names or a YAML list; an allowlist intersected with the parent's tools.                 |
| `model`         | Yes, at spawn | Exact `provider/modelId`; must be available and authenticated.                                          |
| `thinking`      | No            | Supported string level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; omitted means `off`. |
| `skills`        | No            | `none` or an empty list lists no skills; names list only those skills; omitted lists every skill.       |
| `system-prompt` | No            | `replace` drops the `rules` section, as Pi's base prompt; anything else keeps it.                       |

The Markdown body becomes the child's instructions, followed by the extension's agent protocol.
Unknown frontmatter fields are ignored. As in Pi, `system-prompt: replace` replaces only the base
rules: project instructions stay, and `skills` decides the skills listing.

- `tools` may also be a YAML list. An absent key keeps the parent's tool set except this extension's
  own tools. An empty value (`tools: []`, a bare `tools:`, `tools: ""`) gives the child no tools. A
  value that is neither a list of names nor a comma-separated string makes the profile invalid, and
  `agent_spawn` returns an error. With a non-empty list only tools the parent has survive; unknown
  names are dropped silently.
- `model` is matched exactly, with no fuzzy matching, provider mapping or fallback. It is checked with
  `api.models.getAvailable(provider)`, including authentication. A missing, malformed, unknown or
  unauthenticated model returns a tool error before any child conversation or task is created, naming
  the profile and, for an unavailable model, listing that provider's available IDs. Profiles with a
  bad model stay discoverable so spawn can explain the problem.
- Omitted `thinking` means `off`, independent of the parent's level. An invalid value or a level the
  model does not support fails the spawn; there is no clamping.

### Changing a model from the Extensions dialog

`details.tsx` lists every profile a spawn would see, with the model and thinking level its Markdown
names, and a **Change model** button that opens the composer's model menu (`scoped` and `all` tabs,
from the same `enabledModels`; a menu with nothing scoped lists the catalog). The `setModel` action
writes the chosen model and level into the profile's frontmatter, so the next `agent_spawn` uses
them. A profile without a model cannot spawn, so the dialog only changes a model, never removes it.
The same editor appears as the **Subagent models** settings section (`web/profile-models.tsx`).

- The browser sends a profile **name**, never a path. The action looks the name up among the profiles
  discovered for the request's session and writes to the file it belongs to, so a project profile
  stays in the project's `.pi/agents/` and the user profile it replaces is untouched.
- The Extensions dialog has no conversation, so the action resolves profiles from `host.cwd`. A
  profile that exists only under another folder's `.pi/agents/` is not listed there.
- `server/profile-model.ts` rewrites one line per key and no other byte: it follows a symlink, keeps
  line endings and file mode, quotes the value as JSON and replaces the file atomically. It refuses a
  file with no complete frontmatter block, a repeated `model:` or `thinking:` line, a value on several
  lines, or an edit that would change any other field. That is a 400 with the reason, and the file is
  left as it was.
- `thinking` is written together with the model, at a level the chosen model supports. Edit `tools`
  by hand; the dialog does not touch it.

## Behavior

### What the child inherits

The harness starts a task-owned child with the parent's agent configuration, including extensions,
tools and working directory. The extension validates the profile's model and thinking, then sets both
explicitly with the profile's instructions and optional tool allowlist. The parent's model and
thinking are never fallbacks.

- **The parent's transcript is not the child's context.** Every task must include the goal, scope,
  relevant paths, constraints, expected output, and whether edits are permitted, plus the check to
  run for an implementation task. A follow-up through `agent_send` keeps the child's own context.
- Other prompt sections still apply: project instructions and, when the tools permit reading them, the
  skills its `skills` field allows. The profile body replaces only `rules`, and only with
  `system-prompt: replace`.
- The `subagents` extension stays selected in the child for its `rules` and `skills` wraps, but the
  child gets none of the four tools and an empty `agents` section; its `subagents.child` document
  marks it. Recursive delegation is not supported.
- The appended protocol asks the child to keep progress short, return a complete text answer, and end
  with `AGENT_RESULT: done | blocked — <summary>`. If blocked on a question, it ends its turn with that
  question and the parent answers via `agent_send`. The marker is an instruction, not a parsed field.
- **This is not a sandbox.** A child has the parent's machine permissions and, unless `cwd` is given,
  its working directory. A tool allowlist is not a filesystem boundary (`bash` can write files), and
  several editing agents can overwrite one another, so delegate edits only to disjoint file sets. The
  prompt recommends at most four independent agents in parallel; that is guidance, not a limit.

### Reports

When a child's submitted input settles with an answer, the reporter joins the answer entry's text
blocks and sends them to the parent as input:

```text
[agent Review (reviewer) finished]

<the child's answer>
```

No text blocks means `(no text)`. The header says the submission produced an answer; it does not
prove the task succeeded or the answer's claims were checked. Reports use `whenBusy: "steer"`: they
join the parent's current run at its next boundary, or start a run if the parent is idle. A missing
child conversation produces a failure report, as does an unanswered submission unless `agent_stop`
has set the suppression flag.

Each submission has separate model content and application entry data:

| Direction      | Entry kind              | `data.author`  | `data.session`         | `data.text`                            | `data.model`                 |
| -------------- | ----------------------- | -------------- | ---------------------- | -------------------------------------- | ---------------------------- |
| Parent → child | `subagents.instruction` | `Orchestrator` | Parent conversation ID | Task or follow-up text                 | none                         |
| Child → parent | `subagents.report`      | Agent name     | Child conversation ID  | Answer text, without the report header | Provider/model of the answer |

The model reads the submission's `content`; the UI prefers `data.text`, so the person sees the answer
under the agent's name without the header. `data.model` is `provider/model` taken from the reported
answer entry (the engine the provider reported, when it named one), not looked up from the profile, so
a later profile edit cannot relabel a report. Failure reports carry no model, and reports written
before the field existed draw no badge.

Core projects an application entry with a user-role model message and a non-empty string
`data.author` as a user entry with an author; the optional numeric `data.session` supplies the
open-conversation link. This is a generic convention (see
[the server contract](../../docs/server.md#messages-from-application-authors)).

### On screen

`web.tsx` registers the bot icon for the four `agent_*` tools in the activity timeline, plus the
parts below.

- **Report cards.** Authored messages are left-hand cards with an agent-coloured stripe, bot icon,
  name and a first-line preview, folded by default (expand to read Markdown). A report also shows its
  model's name without the provider as a badge before the open-conversation link. While a report or
  instruction is queued, the composer shows its author and mode; it can be withdrawn, but not edited
  and resent as the person's own message.
- **Working-agents strip** (`aboveComposer`). One horizontal line of chips for the agents the open
  conversation started that are working now; nothing is drawn when none are. A chip links to the
  agent's conversation and shows the working mark, name, model (without provider), and a context bar
  with a percentage (an estimate like the context meter's: the agent's latest answer over the model's
  context window; a dash before its first answer; `warn` above 70%). The hover title has the full
  model, profile and exact token counts, and a child in another folder shows its path. When the open
  conversation is itself an agent's, the strip is replaced by a "← Back to <parent title>" link of
  the same height.
- **Agents area** (`sidebarBottom`, with the core's resize handle). Lists every agent of the open
  session, or of the session that started the open one, working first, then finished, newest first. A
  row shows the working mark, name and `working`, or a dimmed name with `4m ago`. It is absent when
  there are none and for an agent whose parent is not in the list (that agent stays a row of the main
  list). A plain click opens the agent in the app. The time is `SessionSummary.endedAt`, the end of
  the conversation's latest run, stored with it; an agent whose end was never recorded shows
  `finished` and sorts last.
- **Status bar** (`start` slot): `· 2 agents working` in the warn colour, counting working agents of
  every parent except the open one; absent at 0. In the status popover, a parent row with a working
  agent shows the mark and count, and opens a submenu of that parent's working agents (hover,
  ArrowRight, Space); a click on the row opens the parent. The marker's count includes the open agent.
- Every commit of an agent calls `host.notifySessionChanged(parent)`. The core sends the parent's
  browsers a new `session.revision` at most every 250 ms and the strip asks again, so nothing polls.
  The `strip` action (`refs.ts`) reads the child's owner from `session.owner`, "working" from the
  commit's busy flag, and name and profile from the parent's `subagents.agents` document via
  `host.readDoc`, so a compaction cannot lose a name. A child the parent has no record of shows as
  "Agent" with no profile or model until its first answer.
- Child sessions are hidden from the main list while their parent is present and appear in the agents
  area instead.

### Stop, direct messages, archive and delete

| Action                          | What happens                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop in the parent conversation | Aborts the parent's foreground run, not its background agents or reporters. Agents keep working; a later report may start the parent again.                    |
| `agent_stop` in the parent      | Sets the child's suppression flag, then aborts its current run. An unanswered submission under that flag produces no report. Context remains for `agent_send`. |
| Stop an already idle agent      | Returns that nothing was running; still sets the flag until the next `agent_send`.                                                                             |
| Stop directly in the child's UI | Aborts the child without setting the flag, so a waiting reporter can send a failure report.                                                                    |
| Type directly into the child    | Runs there, but creates no reporter, so no automatic report.                                                                                                   |
| Archive a session               | Sidebar visibility only; it stops neither the session nor its children.                                                                                        |
| Delete the parent               | Marks it deleted and aborts its foreground run. Its background agents are not stopped. Stop them first.                                                        |
| Delete a child                  | Marks it deleted for the core list; the parent's agent record stays, and `agent_send` still addresses the durable conversation.                                |

Each stop increments a durable counter, so an older reporter is suppressed even after a later
`agent_send` clears the flag. The reporter checks before submitting work and again before preparing a
report; a submission racing with a stop is withdrawn, or its run aborted if the input was already
placed. Stopping is not a recall: a report already prepared or submitted may still arrive. Deleting is
not a purge of stored entries; see [sessions.md](../../docs/sessions.md). Agent records have no
close or remove operation, so finished agents stay addressable and the parent's status list grows.
Turning the extension off does not stop agents; use `agent_stop` first.

### Durability

The pattern comes from Pi Durable's README, "Abort and Subagents", example 23. No custom agent loop
or child process is created here.

`subagents.agents`, version 1, is a conversation-scoped document on the parent:

```text
{
  agents: {
    [name]: {
      conversationId,  // child's durable conversation ID
      agent,           // profile name, not the child's current model
      callId,          // last spawn/send tool call that scheduled work
      reported,        // answer entry IDs already reported
      stopped,         // suppress unanswered results after agent_stop
      stops            // optional stop counter; absent means 0, old reporters cannot deliver
    }
  }
}
```

State lives in the harness, not in a module-level map or a results directory. `reported` grows by one
ID per reported answer, without pruning. The full answers are already entries in the child's
conversation; no separate report files are written.

1. **Spawn transaction:** find a replayed `callId` or choose a free name; create a background
   `subagents.anchor` task owned by the parent; create the child owned by that anchor; configure it;
   save its record; create a background `subagents.reporter` task owned by the parent.
2. **Anchor:** ends immediately. Its ownership is the background boundary that keeps the parent's
   normal abort from reaching the child. It is not a worker loop.
3. **Reporter, `deliver`:** submit the instruction to the child with
   `requestId: subagents:<reporter task ID>` and wait for that submission to settle.
4. **Checkpoint transaction:** suppress the result if the record's `stops` differs from the reporter's
   captured counter, or consult `stopped` for an unanswered submission. For an answer, suppress a
   duplicate `reported` ID or append it, and save the report text and answering model in the task
   checkpoint.
5. **Reporter, `report`:** submit the saved report to the parent with
   `requestId: subagents-report:<reporter task ID>`, then end the reporter task.

`agent_send` schedules another reporter against the same child, unless its `callId` is already stored.
A steering submission can settle with the same answer as the run it joined; the `reported` check lets
only one reporter prepare that report. The tools declare `replay: "safe"`: `callId` guards
scheduling, request IDs guard duplicate submissions, and the checkpoint lets the second phase resume
without asking the child again. Keep these protections when changing the tasks. They protect
extension delivery across replay and restart, not external effects of a child's tools. Do not
casually change task phases, checkpoint shapes or document versions: stored work may still use them.

### Files

| File                      | Responsibility                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `server.ts`               | Installs the tools, tasks and prompt parts from `server/`, tracks working agents for the strip, exports `actions`. |
| `server/profiles.ts`      | Profile discovery, frontmatter parsing, precedence.                                                                |
| `server/tools.ts`         | The four tools.                                                                                                    |
| `server/tasks.ts`         | The anchor task and the reporter task (`deliver`, then `report`).                                                  |
| `server/docs.ts`          | The `subagents.agents` and `subagents.child` documents.                                                            |
| `server/child-agent.ts`   | Turns a profile into the child's model, thinking, tools and instructions, or an error.                             |
| `server/prompt.ts`        | The `agents` section, the child's protocol text, the wraps for `system-prompt` and `skills`.                       |
| `server/answer.ts`        | Reads the text and answering model from an assistant entry.                                                        |
| `server/strip.ts`         | What the strip knows of a working child.                                                                           |
| `server/actions.ts`       | The `agents`, `profiles`, `setModel` and `strip` actions.                                                          |
| `server/profile-model.ts` | Writes `model:` and `thinking:` into a profile's frontmatter, and nothing else.                                    |
| `refs.ts`                 | The action refs and their types, shared by `server.ts`, `web.tsx` and `details.tsx`.                               |
| `web.tsx`, `web/`         | Bot icons, strip, agents area, status count, popover marker, profile editor; `web/area.ts` holds the pure helpers. |
| `details.tsx`             | Mounts the profile editor in the Extensions dialog.                                                                |

### Reloading

- A profile edit is picked up on the next prompt build or spawn; existing children keep their
  configuration.
- `server.ts` or a helper it imports: reinstalled on save; a running tool call finishes on its old
  version, and a broken replacement keeps the last working one.
- `web.tsx`: Vite HMR in development; production needs `pnpm build` and a page refresh.
- Core projection, protocol and UI changes follow the core reload rules. An old server without the
  author convention hides application report entries instead of drawing the cards.

## Verification

```bash
node --test extensions/subagents/
pnpm check
pnpm test
```

`server.test.ts` uses a real `Harness`, real task scheduling and a temporary SQLite file. A faux model
tells parent from child by `## Agent protocol` in the child's system messages; a scripted faux tool
call must use `stopReason: "toolUse"`, or the harness treats it as an answer. Tests set
`PI_CODING_AGENT_DIR` to a temporary directory so the owner's profiles do not leak in. They cover
spawn (separate conversation, instructions, tool allowlist, title, reports with author and source in
both directions, follow-up keeping the original model and thinking), `cwd`, prompt options, profile
and model errors without a child, omitted thinking becoming `off`, and `agent_stop`.
[`test/projection.test.ts`](../../test/projection.test.ts) covers authored entries and queued
messages.

For manual testing use a disposable `PI_DURABLE_DATA_DIR` and a free `PORT`, never the running app's
`data/state.sqlite` or port. Disable unrelated extensions in that data folder before startup, since a
new data directory enables them by default and they may make network requests. A Vite instance must
proxy `/api` to the test server.

## Limits

- **Reports are not length-limited.** The whole answer enters the parent's context and the report
  card, so a 20 000-character review costs that much on every later request until compaction. Folding
  the card saves screen space, not context tokens.
- **Deleting a parent does not stop its agents.** They keep working unseen, hidden from the list. The
  extension registers no `host.onSessionGone` listener. Archiving stops nothing either.
- Direct input into a child creates no report; send through the parent when one is required.
- A stopped, unanswered run is intentionally not reported; continue with `agent_send`.
- Status previews read only the newest 20 entries and the last 2000 characters.
- Not supported: recursive agents, an `ask_question` tool, a full-result status option, model mapping and
  automatic worktree creation (an existing worktree can be selected through `cwd`). Questions travel
  as ordinary final answers.
