# Terminal

A real shell in the session's folder, in the Terminal panel: `node-pty` for the PTY, `@xterm/xterm`
with `addon-fit`, `addon-unicode11` and `addon-clipboard` for the screen. The agent never sees it:
no tools, prompt sections or hooks.

## Usage

- **Stop and Restart** ask before ending a program. The panel reads `state` when the button is
  pressed, never a remembered value, and when the foreground process is not the shell itself (`nvim`,
  `sleep`) the dialog names it and asks first; cancelling puts the caret back in the terminal.
- A stopped shell says so and waits for "Start a new shell"; nothing restarts it by itself. One stop
  or restart runs at a time, and the panel says stopped only once `close` succeeded.
- **Keys.** The shell keeps its keys. The panel stops propagation (`attachCustomKeyEventHandler`) so
  the shell's Escape (closes an expanded panel) does not reach it, and its container carries
  `data-own-keys`, which [Hotkeys](../hotkeys/README.md) reads so even the prefix stays with the
  shell. `macOptionClickForcesSelection` keeps Option+drag selecting under nvim's mouse mode, and
  `addon-clipboard` handles OSC 52, so a yank in nvim or tmux reaches the clipboard.
  `macOptionIsMeta` is deliberately not set: it would eat Option-typed characters.
- **Look.** The panel reads `--role-sunken`, `--role-ink`, `--role-accent`, `--role-raised` and
  Catppuccin's palette names out of `getComputedStyle(document.documentElement)`, and re-reads them
  when `data-flavour` moves. The font mirrors the Ghostty config (`~/.config/ghostty/config.ghostty`):
  `JetBrainsMonoNL Nerd Font`, light, 14.5 px, then the app's `--font-mono` and
  `Symbols Nerd Font Mono` as fallbacks. `document.fonts.load` waits for the font before the cell is
  measured.

## Configuration

The `postinstall` script sets the execute bit on `node-pty`'s `spawn-helper` in the shipped
prebuilds (node-pty 1.1.0's tarball lacks it, and a PTY fails with `posix_spawnp failed`). Where
node-pty builds from source the bit is already set and the step does nothing.

## Behavior

- **One shell per session**, started lazily by `open` in the session's folder with the person's
  `$SHELL` (`/bin/zsh` when unset; a login shell on macOS), `TERM=xterm-256color`. The environment drops `TERM_PROGRAM`,
  `TMUX`, `FORCE_COLOR`, `CLAUDECODE`, `PI_*` and `VSCODE_*`, so the shell does not think it runs
  inside the agent or an editor.
- **Output is a buffer and a number.** `seq` counts every character the shell has sent since it
  started; the buffer keeps the last 256 KB. `open` answers the scrollback and its `seq`; `read` takes
  `after` and long-polls up to 25 seconds for the rest, one answer per burst (output arriving within
  8 ms of the first leaves together). A reader older than the buffer gets what is left and carries on
  from the new `seq`. One read is outstanding per panel; a failed read is retried every 2 seconds
  from the same `after`.
- **Actions:** `open` (start or attach, `{ cols, rows }`), `write` (`{ data }`), `read` (`{ after }`,
  `null` when nothing came), `resize` (`{ cols, rows }`), `state` (the shell's name and the
  foreground program's, from `pty.process`) and `close` (kill). Sizes are integers from 1 to 32767;
  every other argument is checked at the boundary and refused with a 400. A shell that exits reports
  `exited` in the next answer, and the next `open` starts a new one.
- **Ending a shell ends its process group.** `close`, a reload and a deleted session
  (`host.onSessionGone`) send `SIGHUP` to the shell's group and `SIGKILL` two seconds later if it is
  still there.

## Limits

- Nothing outlives the server: a restart loses every shell, and an extension reload kills them.
- Two panels of one session share the shell and the `seq` cursor, so each sees what arrives after
  its own reads; there is no takeover.
- A shell keeps running after its panel closes, until Stop, its own exit, an extension reload or the
  session's deletion.
- There is no key row for a phone keyboard.
