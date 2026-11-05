# Git branch

Shows the git branch of the session's folder under the session's title, and switches or creates it
from a searchable menu. The badge is the button; it is hidden below the `sm` width and disabled while
the agent works.

## Switching

The menu lists the local branches of the session's repository. The search box filters them by a
case-insensitive part of the name, and the current branch carries a check mark.

- A branch that no other worktree has is switched to with `git switch` in the session's folder.
  Git's own refusal (local changes in the way) comes back as a toast.
- A branch that another worktree has checked out is marked with that worktree's folder name.
  Choosing it moves the session to that folder with `host.setSessionCwd`; nothing is switched.
  The session keeps its history, and its next request runs in the worktree.

After a move the browser appends `Worktree changed to <path> (branch <name>).` to the composer
draft, so the agent hears of it with the next message. The draft is never sent for you.

## Creating

While the search names no existing branch — Git names are case-sensitive, so `Main` is not `main` —
the menu offers `Create branch "<query>"`. It runs `git switch -c <name>` in the session's own
folder, at the current commit, and switches the session there; uncommitted changes are kept. The
menu closes on success, and the badge shows the new branch.

- The name is checked with `git check-ref-format --branch` first, so an invalid name, a name that
  starts with `-`, and a history shorthand such as `@{-1}` are refused instead of reaching Git.
- A name that already exists is Git's refusal (`a branch named … already exists`), never an
  overwrite, and it comes back as a toast.
- The option appears only once the branch list has loaded: a query that matches no branch while the
  list is loading or after it failed to load creates nothing.
- Nothing is created while a branch switch or a create is already on its way, so a double click
  does not make two branches.

## Limits

- Local branches only: no remote branches.
- A created branch starts at HEAD of the session's folder. It is not a new worktree.
- A move lands on the worktree's root, not on a subfolder the session was in.
- Refused while the session, or a session it started, is working (`host.sessionWorking`). The check
  and the switch are two steps: a message sent in the same instant can still start a run that the
  switch then reaches.
- A background command the agent started keeps the folder it began in.
- The core change (`setSessionCwd`) needs a server restart; the extension itself reloads live.
