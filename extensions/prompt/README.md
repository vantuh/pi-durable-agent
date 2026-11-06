# Rules prompt

Gives the agent its working rules as system prompt sections, so how the agent behaves comes from an
extension and not from the core.

## Usage

Nothing to operate. Turning the extension off removes all three sections, so the agent gets Pi's
bare prompt.

## Behavior

It adds three sections, all without a tag, rebuilt on every prompt:

- **`rules`**: the project folder, then four short rules (keep a change small, run the checks before
  saying done, ask before anything irreversible, never claim a result you did not see). The text is
  the `RULES` constant in `server.ts`.
- **`project_context`**: Pi's own `AGENTS.md` (or `CLAUDE.md`) files, from `~/.pi/agent` and from the
  session's folder up to `/`, each wrapped as `<project_instructions path="...">`. Nothing when there
  is none.
- **`skills`**: Pi's skills for the session's folder, listed the way Pi lists them. Only when the
  agent has a `read` or `bash` tool, since a skill is loaded by reading its file.

The files are read when the prompt is built, so a change to `AGENTS.md` or a skill applies on the
next run without a restart. A change to the rules text reinstalls the extension.
