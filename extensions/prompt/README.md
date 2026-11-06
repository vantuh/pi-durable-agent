# Rules prompt

`extensions/prompt` is the first extension: everything the agent is told about how to behave is a
system prompt section from a folder like this one, not part of the core. It adds three sections,
all without a tag, rebuilt on every prompt:

- **`rules`**: the project folder, then four short rules (keep a change small, run the checks
  before saying done, ask before anything irreversible, never claim a result you did not see). The
  text is the `RULES` constant in `server.ts`.
- **`project_context`**: Pi's own `AGENTS.md` (or `CLAUDE.md`) files, from `~/.pi/agent` and from the
  session's folder up to `/`, each wrapped as `<project_instructions path="...">`. Nothing when
  there is none.
- **`skills`**: Pi's skills for the session's folder, listed the way Pi lists them. Only when the
  agent has a `read` or `bash` tool, since a skill is loaded by reading its file; nothing
  otherwise.

- **Edits apply on the next run.** The files are read when the prompt is built, so a change to
  `AGENTS.md` or a skill needs no restart. A change to the rules text reinstalls the extension.
- **Configuration.** None. The rules are code; to change them edit `server.ts`. Turning the
  extension off removes all three sections, so the agent gets Pi's bare prompt.
