# Hotkeys

Keyboard shortcuts bound to physical keys (`KeyboardEvent.code`), so they work across keyboard
layouts. It runs the shell's commands through `@/sdk/commands.ts` and supplies each command's first
binding to the core's [keyboard hints](../../docs/extensions.md#keys-for-a-shell-command). Disabling
the extension removes both its shortcuts and its hints.

## Usage

Press the prefix, release it, then press the second key within 1.5 seconds. The status bar shows the
armed prefix. A second prefix passes that key through to the browser; an unbound second key cancels
the sequence and is consumed.

Commands and their default bindings (`ctrl+a` is the prefix):

| Command                      | Default                   | Does                                         |
| ---------------------------- | ------------------------- | -------------------------------------------- |
| `session.new`                | none                      | New session in the folder on screen          |
| `session.new.pick`           | `prefix+c`                | New session, folder picker first             |
| `session.search`             | `prefix+f`                | Session search                               |
| `session.rename`             | `prefix+r`, `prefix+,`    | Renames the session                          |
| `session.prev`               | `shift+left`, `prefix+p`  | Previous session                             |
| `session.next`               | `shift+right`, `prefix+n` | Next session                                 |
| `sidebar.toggle`             | `prefix+b`                | Collapses or expands the sidebar to its rail |
| `extension.git-history.open` | `prefix+g`                | [Git history](../git-history/README.md) list |
| `extension.terminal.open`    | `prefix+t`                | [Terminal](../terminal/README.md) page       |

`sidebar.toggle` is the same toggle as the button in the sidebar header and saves the same state. The
rail exists from `lg` up; below that the sidebar is a full-screen sheet, where the key flips the
saved state and nothing on screen moves.

An extension's own command is named `extension.<folder>.<command>`. The core knows no extension by
name; this file is the only place a key is given to one. It is bound here rather than by the
extension, and newer versions add their defaults to an older file.

## Configuration

`hotkeys.json` in the server's data directory (normally `data/hotkeys.json`), shaped like the
defaults above: `{ "prefix": "ctrl+a", "keys": { "<command>": ["<binding>", …] } }`.

- Override only the entries you need. A command accepts one binding string or a list; `[]` unbinds
  it. Missing or invalid entries keep their defaults; a missing or broken file uses all defaults.
- Modifiers are `ctrl`, `alt`, `shift` and `meta`. Keys are letters, digits, arrows (`left`, `right`,
  `up`, `down`), `escape`, `enter`, `tab`, `space`, and `, . - / [ ]`. A prefix needs Ctrl, Alt or
  Meta. A non-prefixed printable key also needs one of those modifiers.
- Each mounted browser reads the map once. After editing the file, reload that page.

## Behavior

- A normal field keeps its keys except the prefix.
- A field inside `[data-shell-keys]`, including the composer's textarea, also lets unprefixed shell
  shortcuts through, so Shift+Left/Right switches sessions there.
- A field inside `[data-own-keys]`, such as the terminal, keeps every key, the prefix included.
- Dialogs keep the keyboard unless a prefix sequence was already armed.
- Composition input and repeated key presses do not run commands.
