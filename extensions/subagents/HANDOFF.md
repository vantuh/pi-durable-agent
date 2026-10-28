# Subagents: work handoff

Written for whoever continues this extension. It has the state of the work, how it is built, the
decisions already made (with the reasons), the open items in the order they were recommended, and
how to check each one. Read it top to bottom once; each open item stands on its own after that.

The current usage and maintenance guide is [README.md](README.md). This handoff preserves the
original investigation and proposals; its live-database evidence and deployment notes below are
historical, not a fresh inspection of the owner's running app. Follow-ups 3 (strict profile model
and thinking), 4 (icons), and 5 (documentation) are complete; items 1–2 remain open.

## Where things stand

Commits on `main`, oldest first:

| Commit    | What                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| `bef0a20` | The extension: `profiles.ts`, `server.ts`, first tests                                   |
| `28f5e9f` | Tests drive the tools through a faux model; gate green                                   |
| `2d45299` | **Core**: a message with `data.author` shows as an agent's card, in transcript and queue |
| `ae6588d` | The extension names the agent on reports and "Orchestrator" on the tasks it hands out    |
| `08e5766` | The browser facet gives all four `agent_*` tools bot icons                               |

`pnpm check` is clean and `pnpm test` passes (312 tests at the time of writing).

Verified for real, not only in tests: parallel sessions of the running app spawned agents, steered
them with `agent_send` and got their reports (see "Evidence from the live database" below).

**Not yet live in the owner's app.** It runs from `pnpm start` (built `dist/`), so the core and web
changes of `2d45299` need a rebuild and a server restart. The extension's server half reloads by
itself; its report entries still carry `author`, and an old server projects them as `kind: "other"`
(hidden) until it restarts — so restart soon after pulling, or reports are invisible on screen.
Reports that arrived before `ae6588d` are plain user messages starting with `[agent …]` and stay so.

## How it works

Pattern: Pi Durable's README, section "Abort and Subagents", example 23 (the example file itself is
not shipped in `node_modules`; the README text is the reference).

- **One agent = one conversation**, created inside `api.commit()` and owned by an `Anchor` task.
  The anchor is a background task that ends at once. Background is the point: the parent's Stop
  (`conversation.abort()` without `{ background: true }`) does not reach the agent, and the parent
  is not "busy" while its agents work.
- **The child copies the parent's agent** (model, extensions, tools, cwd) — the harness does this
  for a task-owned conversation — and `configure()` then applies the profile: `instructions`
  (profile body + `PROTOCOL`), `model`, `thinkingLevel`, `tools` (allowlist by name), and
  `extensions: { remove: [self] }` so an agent cannot spawn agents. `self` is a stub
  `defineExtension({ name: host.name })`: extensions are stored by name, so the stub removes the
  real one.
- **Every message to an agent is a `Reporter` task** (background, owned by the parent
  conversation). Phase `deliver`: submit to the child (`whenBusy: "steer"`, `requestId
  subagents:<taskId>`), wait for the submission to settle, commit the report into the checkpoint.
  Phase `report`: submit the report to the parent (`whenBusy: "steer"`, `requestId
  subagents-report:<taskId>`). Request IDs make both submissions idempotent across a restart.
- **State** is one conversation document on the parent, `subagents.agents`:
  `{ agents: { [name]: { conversationId, agent, callId, reported, stopped } } }`.
    - `callId` — the last tool call that sent the agent work. A replayed call (tools are
      `replay: "safe"`) finds its own `callId` and creates nothing twice.
    - `reported` — answer entry IDs already reported. A steered message joins the run already in
      progress; both reporters then settle with the same answer, and only the first reports it.
    - `stopped` — set by `agent_stop`; a reporter whose submission ends `unanswered` reports nothing
      while it is set. `agent_send` clears it.
- **Entries.** The task to the child is an input placed as `subagents.instruction`
  `{ text, author: "Orchestrator", session: <parent id> }`; the report to the parent as
  `subagents.report` `{ text, author: <agent name>, session: <child id> }`. The model reads the
  submission's `content` (the report starts with `[agent Name (profile) finished]`); the screen
  reads `data.text` under `data.author`.
- **Core convention** (`server/projection.ts`, `authorOf`/`userOf`): an entry of any application
  kind whose model message is `role: "user"` and whose `data.author` is a non-empty string is
  projected as `kind: "user"` with `author: { name, session? }`. The same for queued inbox items
  (`ClientQueued.author`). The browser draws it with `web/src/transcript/agent-message.tsx` and the
  `AGENT` look in `web/src/composer/queued.tsx`; colour role `--role-agent` (Catppuccin teal).
  Core names no extension.
- **Prompt section** `agents`: the orchestrator rules (`GUIDE`) plus the profiles list, read from
  disk on every prompt build. Agents do not get it (the extension is removed from them).
- **Profiles** (`profiles.ts`): `~/.pi/agent/agents/*.md` (`getAgentDir()`, so
  `PI_CODING_AGENT_DIR` moves it), then the nearest `.pi/agents/` above the conversation's cwd,
  which overrides by name. Frontmatter read: `name`, `description` (both required), `tools`
  (comma list or YAML list), `model` (`provider/id`), `thinking`. The body is the instructions.

Files: `server.ts` (tools, tasks, doc, section), `profiles.ts`, `server.test.ts`, `web.tsx`
(tool icons), `README.md` (current guide), and this handoff.

### Tests

`server.test.ts` runs a real `Harness` on a temporary SQLite file with `fauxProvider()`. One
response factory serves parent and child; it tells them apart by `"## Agent protocol"` in the
system messages. A tool call needs `stopReason: "toolUse"` (helper `call()`), or the harness
treats it as the final answer. `PI_CODING_AGENT_DIR` points at the temp folder, so the owner's real
profiles never leak in; the test profile lives in `<tmp>/.pi/agents/`.

Both tests were mutation-checked: removing the `stopped` check fails the stop test; dropping
`extensions: { remove: [self] }` fails the first test.

Run: `node --test extensions/subagents/` (fast), then `pnpm check` and `pnpm test`.

### Seeing the UI without touching the owner's app

The owner's app runs on `:8788` from `dist/`, with `data/state.sqlite`. Never use either for tests.
What worked:

1. `D=$(mktemp -d /tmp/subagents-ui-XXXX)`; write `$D/extensions.json` as
   `{ "disabled": [every folder except subagents] }` so MCP, keep-warm, push and the rest stay off.
2. Seed `$D/state.sqlite` with a small script run from the project root through
   `node --input-type=module -` (so imports resolve to the project's `node_modules`):
   `Harness.open` → `createConversation` → `harness.commit(tx => tx.appendEntry(...))` for
   `chat.user`, `pi.assistant`, `subagents.report` entries; for the queue, `tx.createSubmission({
   conversationId, type: "input", status: "queued" })` and push items into `tx.doc(InboxDoc, id)`.
3. `PI_DURABLE_DATA_DIR=$D PORT=8799 node server/main.ts`.
4. Vite on another port proxying to it. A config outside the project fails to resolve `vite` and
   breaks the Tailwind plugin; put it under `node_modules/.cache/<name>/vite.config.ts` (ignored by
   git): `mergeConfig(base, { root: "<abs>/web", server: { port: 5191, proxy: { "/api": { target:
   "http://127.0.0.1:8799" } } } })`, and run `node_modules/.bin/vite --config <that file>`.

## Evidence from the live database

Read from a copy (`cp data/state.sqlite* /tmp/…`, `sqlite3 -readonly`), never the file itself.
Agent conversations are the rows of `conversations` whose `record` has an `owner`.

| Parent | Agent (profile)          | Profile asks for             | Actually ran on                   |
| ------ | ------------------------ | ---------------------------- | --------------------------------- |
| 24052  | dictation-port (worker)  | `kiro-acp/claude-sonnet-5.5` | `opencode-go/deepseek-v4.1-flash` |
| 23703  | AuditCore (reviewer)     | `kiro-acp/claude-opus-5.5`   | `openai/gpt-6.1-sol`              |
| 23703  | AuditEvidence (reviewer) | `kiro-acp/claude-opus-5.5`   | `openai/gpt-6.1-sol`              |

All three historical spawns fell back to the parent's model. That fallback is now removed
(completed item 3 below). `AuditCore` and `AuditEvidence` have two answers each in `reported`, so
follow-ups through `agent_send` delivered.

## Open items, in recommended order

### 1. Separate agent navigation from main sessions

**Owner's revised direction; implementation pending.** Do not nest agents among the main session
rows. First review a [standalone UI mockup](../../docs/mockups/README.md) for working agents above
the composer: active agents only, links to their conversations, working marks, context fill and
TPS, with the model secondary. Implement that feature only after design approval, then stop for
the owner's verification. Only afterwards add a height-resizable lower sidebar area with all
agents of the selected parent, including finished ones, and remove children from the main list.
The lower area must be absent for a parent with no agents; visiting a child must retain an obvious
parent/sibling navigation path. Deletion semantics still need a decision. The original options
below are investigation context, not the current approved UI direction.

**Problem.** `Sessions.list()` (`server/sessions.ts`) scans every conversation, so each agent is a
top-level row next to the person's sessions. A parent with four agents adds four rows; a
long-running project adds dozens. The rows are useful (open an agent, watch it, type into it), so
the goal is to place them, not to hide them outright.

**Facts to build on.**

- `ConversationRecord.owner` is `{ conversationId, taskId }` for a task-owned conversation; the
  conversations table indexes `owner_conversation_id`. `tx.conversation(id)` returns the record,
  `tx.scanConversations({ ownerTaskId })` also exists. `owner.conversationId` is the parent.
- The child's title is already set at spawn: `"<Name>: <task, 60 chars>"` (`host.setSessionTitle`).
- Pi Pocket draws "linked sessions" as a tree: `web/session-tree.js` (`sessionForest`) in
  `/Users/vantuh/projects/opensource-test/pi-pocket` — parent map, cycle guard, up to three indent
  levels, a fold per parent with a count pill ("N linked sessions"), a dot on a folded row when a
  child waits or failed, pinned rows stay top-level. `web/sessions.js` uses it. Read, rewrite; do
  not copy (AGENTS.md rules).

**Options.**

- **A. Nest under the parent (original recommendation, superseded).** Add `parent?: number` to `SessionSummary`
  (`shared/protocol.ts`), filled in `Sessions.list()` from `ConversationRecord.owner?.conversationId`.
  This is generic ("this conversation was started from that one"), not subagent-specific, so it
  passes the core rule. In `web/src/shell/sessions.tsx`, group children under their parent, folded
  by default, with a count and a working dot when any child is busy. A child whose parent is not
  in the list (deleted, archived, other folder filter) shows top-level.
- **B. Hide owned conversations behind a toggle.** Smaller, but the person loses the easy way to
  watch an agent; the report card's open button (already built) would be the only way in.
- **C. Do nothing in core; the extension marks child rows** with `host.setSessionMark`. Cheap, but
  the list still grows.

**Watch out.**

- The core change needs its reason in the commit body (AGENTS.md: "A change to the core needs a
  reason").
- `Sessions.list()` already does one harness call per conversation; reading the record is one more
  `tx.conversation()` per row. Fine for hundreds, keep it in the same commit as the other reads.
- Deleting a parent (`Sessions.delete`) calls `abort()` without `{ background: true }`, so its
  agents keep running unseen. Decide together with this item: either abort with
  `{ background: true }` there (core; it then stops anything background in that conversation), or
  have the extension stop a parent's agents when it is deleted (it has no hook for that today).
- Deleting a child from the sidebar hides it, but the parent's `agent_send` still reaches it. Fine
  as is; mention it if the UI shows "deleted".

**Original acceptance criteria (superseded).** Rows nest, fold and unfold; a busy agent marks its
folded parent; the open button on a report card still lands on the child; a session list test
covers the parent field (see `test/sessions-*.test.ts` for the harness-backed pattern). Use the
revised two-step direction above for the next implementation, not these tree-view criteria.

### 2. Bound long reports

**Problem.** The whole answer goes into the parent's context. A reviewer's 20 000-character report
costs the orchestrator that much on every later request, until compaction.

**Reference.** pi-herdr-subagents (`/Users/vantuh/projects/personal/pi-herdr-subagents`):
`src/output.ts` keeps the first 4 000 and the last 2 000 characters, cut at line boundaries, joined
by `… N characters omitted …`, and adds `Full report saved to <path>`; `src/reports.ts` writes the
full text to `~/.pi/agent/pi-herdr-subagents-results/` (0700 dir, 0600 files, 30-day prune).
`docs/tool.md` section "Bounded delivery" has the exact rules.

**Here it is simpler, because the full answer is already durable:** it is an entry in the child's
conversation. No file is needed. In `Reporter.deliver`, when `answer.length > 6000`, put the
excerpt in the report `content` and say where the rest is: `agent_status({ name })` (extend it to
return the full latest answer on request, e.g. a `full: true` parameter), or the child session
the person can open. Keep `data.text` (what the screen shows) as the full answer: the card is
folded anyway.

**Watch out.** Cut on line boundaries; never cut inside a fenced code block if it can be avoided
(or close the fence). Unit-test the excerpt function — it is the one genuinely fiddly piece.

## Completed follow-ups

### 3. Strict profile model and thinking

The owner chose profile-only configuration, not model mapping or fallback:

- `agent_spawn` accepts only `agent`, `task`, and optional `name`; schema validation rejects extra
  arguments, including model/thinking overrides, even when they match the profile.
- The Markdown profile must specify an exact `provider/modelId`. Missing, malformed, unavailable,
  or unauthenticated models return `isError` before a child or its background tasks are created.
  The error identifies the profile/problem and, for an unavailable model, available IDs for that
  provider. There is no fallback to the parent and no provider mapping.
- Thinking comes only from the profile, with `off` for an omitted field. Invalid values and
  unsupported levels are errors, not inherited values or silently clamped alternatives.
- The orchestrator prompt and tool description explain that a rejected spawn started no agent;
  choose another existing profile or ask the user to fix the profile/provider/auth setup.
- Real-Harness tests cover these refusals, a distinct profile model/level, omitted thinking, and
  keeping the original configuration on a follow-up after editing the profile file.

Keep `getAvailable()` rather than catalog-only `getModel()`: authentication is part of availability.
The earlier suggestion to add the actual model to report headers was not implemented; it is not
needed for the owner's chosen refusal policy, and the child's statistics already expose its model.

### 4. A tool icon for `agent_*`

Completed in `08e5766`. `web.tsx` registers `Bot` for `agent_spawn`, `agent_send`, `agent_stop`,
and `agent_status`, through the existing `WebExtension.tools` contract. Vite HMR applies it in
development; production needs a browser rebuild. The change passed `pnpm check`, all 312 tests,
and a production build into an isolated cache directory; that does not establish deployment to
the owner's app.

### 5. Documentation

- [README.md](README.md) documents current usage, profile precedence and field semantics, strict
  model/thinking validation, the four tools, context inheritance, reports and UI, stop/delete
  behavior, durable tasks/state, reload rules, checks, troubleshooting, and deliberate limits.
- [docs/extensions.md](../../docs/extensions.md#subagents) lists this feature as implemented,
  links to the local guide, and no longer lists it among planned folders.
- [docs/server.md](../../docs/server.md#messages-from-application-authors) describes the generic
  author convention for committed and queued messages, including separate model/display text.
- `AGENTS.md` is unchanged; its broader extension inventory remains outside this follow-up.

## Deliberately not done

- **`ask_question` tool** (pi-herdr-subagents has one). Here an agent ends its turn with the
  question; the report reaches the parent, which answers with `agent_send`. Works because the
  child's conversation keeps its context. Add a tool only if questions get lost among results.
- **`system-prompt: replace`** in profiles. The child's system prompt is the other extensions'
  sections (rules, project context, skills) plus `instructions`. Replacing would mean removing the
  `prompt` extension by name, which breaks the rule that extensions do not know each other. The
  profile body is always appended.
- **`skills`** in profiles: ignored; the child sees the same skills section as the parent.
- **The `agents` count in the status bar** that `docs/extensions.md` mentions: not built.

## Smaller things noticed

- `reported` grows by one entry ID per answer, forever. Harmless for now; trim to the last few if
  the document ever gets large.
- Agents never close. `agent_status` without a name lists every agent the conversation ever
  started, idle or not. If that list gets long, show only working agents plus the last few idle.
- `agent_stop` sets `stopped` even when the agent was idle; the next `agent_send` clears it, so
  nothing is lost, but a run the person starts by typing into the child directly is unaffected
  either way (no reporter, so no report).
- A message the person types into an agent's conversation directly produces no report to the
  parent. Probably right; say so in the docs.
