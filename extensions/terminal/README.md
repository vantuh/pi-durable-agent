# Terminal

`extensions/terminal` is a real shell in the session's folder, in the Terminal panel: `node-pty` for
the PTY, `@xterm/xterm` with `addon-fit`, `addon-unicode11` and `addon-clipboard` for the screen. The
agent never sees it — no tools, prompt sections or hooks — and nothing outlives the server: a restart
loses every shell, an extension reload kills them.

## Behavior

- **One shell per session**, started lazily by `open` in the session's folder with the person's
  `$SHELL` (a login shell on macOS, `/bin/zsh` when `$SHELL` is unset), `TERM=xterm-256color`. The
  environment drops `TERM_PROGRAM`, `TMUX`, `FORCE_COLOR`, `CLAUDECODE`, `PI_*` and `VSCODE_*`, so a
  shell does not think it is running inside the agent or an editor.
- **Output is a buffer and a number.** `seq` counts every character the shell has sent since it
  started; the buffer keeps the last 256 KB. `open` answers the scrollback and its `seq`, and `read`
  takes `after` and long-polls up to 25 seconds for the rest — one answer per burst, since output that
  arrives within 8 ms of the first leaves together. A reader older than the buffer gets what is left
  there and carries on from the new `seq`. Exactly one read is outstanding per panel; a failed read is
  retried every 2 seconds from the same `after`.
- **The actions** are `open` (start or attach, `{ cols, rows }`), `write` (`{ data }`), `read`
  (`{ after }`, `null` when nothing came), `resize` (`{ cols, rows }`), `state` (the shell's name and
  the foreground program's, from `pty.process`) and `close` (kill). Sizes are integers from 1 to
  32767; every other argument is checked at the boundary and refused with a 400. A shell that exits
  reports `exited` in the next answer, and the next `open` starts a new one.
- **Stop and Restart ask before ending a program.** The panel reads `state` when the button is
  pressed — never a remembered value — and when the foreground process is not the shell itself
  (`nvim`, `sleep`) the dialog names it and asks first; cancelling puts the caret back in the
  terminal. A stopped shell says so and waits for Start a new shell; nothing restarts it by itself.
  One stop or restart runs at a time, and the panel says stopped only once `close` succeeded.
- **Ending a shell ends its process group.** `close`, a reload and a deleted session (through
  `host.onSessionGone`) send `SIGHUP` to the shell's group and `SIGKILL` two seconds later if it is
  still there, so a shell that ignores the hangup does not survive.

## Look

- **Colours come from the theme at run time.** The terminal paints with concrete strings, so the panel
  reads `--role-sunken`, `--role-ink`, `--role-accent`, `--role-raised` and Catppuccin's palette names
  out of `getComputedStyle(document.documentElement)`, and re-reads them when `data-flavour` moves.
- **The font mirrors the Ghostty config** (`~/.config/ghostty/config.ghostty`): `JetBrainsMonoNL Nerd
  Font`, light, 14.5 px, then the app's `--font-mono` and `Symbols Nerd Font Mono` as fallbacks, so
  prompt icons draw on a machine without the first. `document.fonts.load` waits for the font before
  the cell is measured, or every glyph would be sized for the fallback.

## Keys

The shell keeps its keys. Two bindings would otherwise reach into it: the shell closes an expanded
panel on Escape (a window listener in the bubble phase) and hotkeys arms its prefix on `ctrl+a` (a
window listener in the capture phase, which runs before the terminal can stop it). The panel does both
halves: `attachCustomKeyEventHandler` stops propagation, and the container carries `data-own-keys`,
which [Hotkeys](../hotkeys/README.md) reads so even the prefix stays with the shell.
`macOptionClickForcesSelection` keeps Option+drag selecting under nvim's mouse mode, and
`addon-clipboard` handles OSC 52, so a yank in nvim or tmux reaches the clipboard. `macOptionIsMeta`
is deliberately not set: it would eat Option-typed characters.

## Install

The `spawn-helper` in node-pty 1.1.0's shipped prebuilds has no execute bit in the tarball, and a PTY
fails with `posix_spawnp failed` without it. The root `postinstall` script sets it; on a machine
where node-pty builds from source the file already has it and the step does nothing.

## Limits

No persistence across a server restart, and no takeover between two panels of one session: they
share the shell and the `seq` cursor, so each sees what arrives after its own reads. A shell keeps
running after its panel closes, until Stop, its own exit, an extension reload or the session's
deletion. There is no key row for a phone keyboard.
