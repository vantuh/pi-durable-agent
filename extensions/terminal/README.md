# Terminal

Real shells in the session's folder, in tabs on the Terminal page: `node-pty` for the PTY,
`@xterm/xterm` with `addon-fit`, `addon-unicode11` and `addon-clipboard` for the screen. The agent
never sees them: no tools, prompt sections or hooks.

## Usage

- **Open it** from the terminal button in the conversation header, or with `prefix+t`
  (`extension.terminal.open`, rebindable in `data/hotkeys.json`). The page takes the conversation's
  place, as Git history does; the button sits before Git history's badge and shows how many tabs the folder has in an accent badge on its top right corner. A folder with none gets
  its first tab when the page opens.
- **Tabs.** `+` starts a new shell in a new tab; a tab's title is what runs in it now (`zsh`, `node`,
  `nvim`), re-read every 2 seconds. Close (the `×` in the toolbar) ends the tab's shell and the tab;
  closing the last tab returns to the conversation. The page comes back to the tab the folder showed
  last.

- **Stop, Restart and Close** ask before ending a program. The panel reads `state` when the button is
  pressed, never a remembered value, and when the foreground process is not the shell itself (`nvim`,
  `sleep`) the dialog names it and asks first; cancelling puts the caret back in the terminal.
- A stopped shell keeps its tab, says so and waits for "Start a new shell"; nothing restarts it by
  itself. The exception is the folder's only tab: when its shell exits or is stopped, the tab is
  removed and the page returns to the conversation, as Close does. One stop, restart or close runs at a time, and the page says stopped only once `close`
  succeeded.
- **Keys.** The shell keeps its keys. The page stops propagation (`attachCustomKeyEventHandler`) so
  the shell's Escape does not reach the app, and its container carries
  `data-own-keys`, which [Hotkeys](../hotkeys/README.md) reads so even the prefix stays with the
  shell. `macOptionClickForcesSelection` keeps Option+drag selecting under nvim's mouse mode, and
  `addon-clipboard` handles OSC 52, so a yank in nvim or tmux reaches the clipboard.
  `macOptionIsMeta` is deliberately not set: it would eat Option-typed characters.
- **Look.** The page reads `--role-sunken`, `--role-ink`, `--role-accent`, `--role-raised` and
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

- **Shells belong to the folder**, one per tab: every session whose folder (`cwd`) is the same sees
  the same tabs, so a server started from one session is there in the next. `create` starts one in
  the folder with the person's `$SHELL` (`/bin/zsh` when unset; a login shell on macOS),
  `TERM=xterm-256color`, at 80 by 24 until the page resizes it. The environment drops `TERM_PROGRAM`,
  `TMUX`, `FORCE_COLOR`, `CLAUDECODE`, `PI_*` and `VSCODE_*`, so the shell does not think it runs
  inside the agent or an editor.
- **Output is a buffer and a number.** `seq` counts every character the shell has sent since it
  started; the buffer keeps the last 256 KB. `open` answers the scrollback and its `seq`; `read` takes
  `after` and long-polls up to 25 seconds for the rest, one answer per burst (output arriving within
  8 ms of the first leaves together). A reader older than the buffer gets what is left and carries on
  from the new `seq`. Each reader keeps its own `after`, so two pages on one tab both see everything.
  Only the active tab is mounted, so a page holds one read, not one per tab (a browser allows six
  connections to one host); a failed read is retried every 2 seconds from the same `after`.
- **Attaching again repaints.** The replayed scrollback holds queries a program once sent (OSC 11,
  DECRQM); the page drops xterm's answers to them until the replay is written, so they never reach
  the shell as typed text (keys pressed in that moment are dropped too). When the foreground is not
  the shell, `open` sets the size one row off and back 100 ms later, so `nvim` or `lazygit` redraws
  the whole screen instead of leaving what the 256 KB buffer cut in half.
- **Actions:** `list` (the folder's tabs: `id`, `title`, `exited`), `create` (a new tab, answering
  its `id`), and, each with `tab`: `open` (attach, or start a new shell in a tab whose shell ended,
  `{ cols, rows }`), `write` (`{ data }`), `read` (`{ after }`, `null` when nothing came), `resize`
  (`{ cols, rows }`), `state` (the shell's name and the foreground program's, from `pty.process`),
  `close` (kill, keep the tab) and `remove` (kill, drop the tab). Sizes are integers from 1 to 32767,
  tabs whole numbers from 1; every other argument is checked at the boundary and refused with a 400.
  A shell that exits reports `exited` in the next answer, and the next `open` starts a new one.
- **The header's count follows the tabs.** A tab created or removed, or a shell that exits by itself,
  calls `host.notifySessionChanged` for every session that used the folder's terminal.
- **Ending a shell ends its process group.** `close`, `remove`, a reload, and the deletion of the last
  session that used the folder's terminal (`host.onSessionGone`) send `SIGHUP` to the shell's group
  and `SIGKILL` two seconds later if it is still there.

## Limits

- Nothing outlives the server: a restart loses every shell, and an extension reload kills them.
- A session uses the folder's terminal once any of its calls reached the server, the header's count
  included. A session in the folder that was never shown in this process does not keep the shells: when
  every session that did is deleted, they end.
- A session moved to another folder (`setSessionCwd`) sees the new folder's tabs, but still counts as
  a user of the old one until it is deleted.
- Two pages on one tab share its size: the last one to resize wins, and the other wraps to it.
- A shell keeps running after its page closes, until Stop, Close, its own exit, an extension reload
  or the deletion of the folder's last session.
- There is no key row for a phone keyboard.
