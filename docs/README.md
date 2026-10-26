# pi-durable-agent

Decisions written down before code, so that code can be read against them.
The rules an agent works under are in [../AGENTS.md](../AGENTS.md).

| Document                         | Holds                                                    |
| -------------------------------- | -------------------------------------------------------- |
| [stack.md](stack.md)             | What we build with, why, what it costs, what stays open. |
| [layout.md](layout.md)           | The shell: sidebar, conversation, right drawer.          |
| [conventions.md](conventions.md) | Every rule, and the mistake it prevents.                 |

Planned, not written yet: `agent.md` (tools, prompt, permissions).

## Ground rules

- One user, one process, localhost. No accounts, roles, invites, or sharing until something
  needs them.
- The agent is `@earendil-works/pi-durable`, not our code. We write the shell around it.
- Personal behaviour goes into extensions, not into the core.
