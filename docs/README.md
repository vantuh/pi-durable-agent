# pi-durable-agent

Reference for the code as it is. The rules an agent works under are in [../AGENTS.md](../AGENTS.md).

## Architecture

| Document                       | Holds                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| [stack.md](stack.md)           | What we build with, why, what it costs, what we did not take. |
| [server.md](server.md)         | The HTTP and SSE API, and how a conversation runs.            |
| [sessions.md](sessions.md)     | The session list, its live state, seen, archive and delete.   |
| [extensions.md](extensions.md) | The extension folder: contract, actions, web slots, reload.   |

## Interface

| Document               | Holds                                                         |
| ---------------------- | ------------------------------------------------------------- |
| [layout.md](layout.md) | The shell: sidebar, conversation, drawer, status bar, toasts. |
| [theme.md](theme.md)   | The Catppuccin theme and its roles.                           |
| [pwa.md](pwa.md)       | Manifest, icons, and the offline shell worker.                |

## Working on it

| Document                         | Holds                                            |
| -------------------------------- | ------------------------------------------------ |
| [running.md](running.md)         | Running it, and the production build on a phone. |
| [conventions.md](conventions.md) | Every rule, and the mistake it prevents.         |

Extension-specific guides live in `extensions/<name>/README.md`; the
[extension guide index](extensions.md#extension-guides) links to them. Shared contracts and
architecture decisions stay here.

## Ground rules

- One user, one process, localhost. No accounts, roles, invites, or sharing until something
  needs them.
- The agent is `@earendil-works/pi-durable`, not our code. We write the shell around it.
- Personal behaviour goes into extensions, not into the core.
