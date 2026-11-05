# Hotkeys

`extensions/hotkeys` binds physical keys (`KeyboardEvent.code`), so shortcuts work across keyboard
layouts. It runs the shell's commands through `@/sdk/commands.ts` and supplies each command's first
binding to the core's [keyboard hints](../../docs/extensions.md#keys-for-a-shell-command). Disabling
the extension removes both its shortcuts and its hints.

## Defaults and configuration

`hotkeys.json` lives in the server's data directory (normally `data/hotkeys.json`). These are the
complete defaults:

```json
{
    "prefix": "ctrl+a",
    "keys": {
        "session.new": [],
        "session.new.pick": ["prefix+c"],
        "folder.pick": ["prefix+s"],
        "session.search": ["prefix+f"],
        "session.rename": ["prefix+r", "prefix+,"],
        "session.prev": ["shift+left", "prefix+p"],
        "session.next": ["shift+right", "prefix+n"],
        "extension.git-history.open": ["prefix+g"]
    }
}
```

Two commands start a session: `session.new` takes the folder on screen at once and `session.new.pick`
opens the folder picker first. The picker is bound by default; `session.new` is there for a key of
your own.

- Press the prefix, release it, then press the second key within 1.5 seconds. The status bar shows
  the armed prefix. A second prefix passes that key through to the browser; an unbound second key
  cancels the sequence and is consumed.
- Override only the entries you need. A command accepts one binding string or a list; `[]` unbinds
  it. Missing or invalid entries keep their defaults; a missing or broken file uses all defaults.
- Modifiers are `ctrl`, `alt`, `shift` and `meta`. Keys are letters, digits, arrows (`left`, `right`,
  `up`, `down`), `escape`, `enter`, `tab`, `space`, and `, . - / [ ]`. A prefix needs Ctrl, Alt or
  Meta. A non-prefixed printable key also needs one of those modifiers.
- Each mounted browser reads the map once. After editing the file, reload that page to apply it.
- `extension.git-history.open` is [Git history](../git-history/README.md)'s commit list for the
  conversation on screen. An extension's own command is named `extension.<folder>.<command>`: the
  core knows no extension by name, and this file is the only place a key is given to one. It is
  bound here rather than by the extension, and newer versions add their defaults to an older file.

## Fields and dialogs

A normal field keeps its keys except the prefix. A field inside `[data-shell-keys]`, including the
composer's textarea, also lets unprefixed shell shortcuts through, so Shift+Left/Right switches
sessions there. A field inside `[data-own-keys]`, such as the terminal, keeps every key, the prefix
included. Dialogs keep the keyboard unless a prefix sequence was already armed. Composition
input and repeated key presses do not run commands.
