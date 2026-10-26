# pi-durable-agent

Decisions written down before code, so that code can be read against them.

| Document               | Holds                                                    |
| ---------------------- | -------------------------------------------------------- |
| [stack.md](stack.md)   | What we build with, why, what it costs, what stays open. |
| [layout.md](layout.md) | The shell: sidebar, conversation, right drawer.          |

Planned, not written yet: `server.md` (HTTP and event transport), `theme.md` (Catppuccin),
`agent.md` (tools, prompt, permissions).

## Ground rules

- One user, one process, localhost. No accounts, roles, invites, or sharing until something
  needs them.
- The agent is `@earendil-works/pi-durable`, not our code. We write the shell around it.
- Personal behaviour goes into extensions, not into the core.
