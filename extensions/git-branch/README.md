# Git branch

Shows the git branch of the session's folder under the session's title, and switches or creates
branches from a searchable menu.

## Usage

The badge is the button. It is hidden below the `sm` width and disabled while the agent works. The
menu lists the local branches of the session's repository; the search box filters them by a
case-insensitive part of the name, and the current branch carries a check mark.

- **Switching.** A branch that no other worktree has is switched to with `git switch` in the
  session's folder. Git's own refusal (local changes in the way) comes back as a toast.
- **Another worktree's branch.** A branch checked out in another worktree is marked with that
  worktree's folder name. Choosing it moves the session to that folder with `host.setSessionCwd`;
  nothing is switched. The session keeps its history, and its next request runs in the worktree.
  After a move the browser appends `Worktree changed to <path> (branch <name>).` to the composer
  draft, so the agent hears of it with the next message. The draft is never sent for you.
- **Creating.** While the search names no existing branch (Git names are case-sensitive, so `Main`
  is not `main`), the menu offers `Create branch "<query>"`. It runs `git switch -c <name>` in the
  session's folder, at the current commit, and switches the session there. Uncommitted changes are
  kept. The menu closes on success and the badge shows the new branch.

## Behavior

- The new name is checked with `git check-ref-format --branch` first, so an invalid name, a name that
  starts with `-` and a history shorthand such as `@{-1}` are refused instead of reaching Git.
- A name that already exists is Git's refusal (`a branch named … already exists`), never an
  overwrite, and it comes back as a toast.
- The create option appears only once the branch list has loaded, so a query that matches nothing
  while the list is loading or after it failed to load creates nothing.
- Nothing is created while a switch or a create is already on its way, so a double click does not
  make two branches.
- The core's `setSessionCwd` needs a server restart; the extension itself reloads live.

## Limits

- Local branches only. A created branch starts at HEAD of the session's folder; it is not a new
  worktree.
- A move lands on the worktree's root, not on a subfolder the session was in.
- Refused while the session, or a session it started, is working (`host.sessionWorking`). The check
  and the switch are two steps, so a message sent in the same instant can still start a run that the
  switch then reaches.
- A background command the agent started keeps the folder it began in.
