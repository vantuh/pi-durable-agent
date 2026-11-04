# Git branch

Shows the git branch of the session's folder under the session's title, and switches it from a
dropdown. The badge is the button; it is hidden below the `sm` width and disabled while the agent works.

## Switching

The menu lists the local branches of the session's repository.

- A branch that no other worktree has is switched to with `git switch` in the session's folder.
  Git's own refusal (local changes in the way) comes back as a toast.
- A branch that another worktree has checked out is marked with that worktree's folder name.
  Choosing it moves the session to that folder with `host.setSessionCwd`; nothing is switched.
  The session keeps its history, and its next request runs in the worktree.

After a move the browser appends `Worktree changed to <path> (branch <name>).` to the composer
draft, so the agent hears of it with the next message. The draft is never sent for you.

## Limits

- Local branches only: no creating a branch and no remote branches.
- A move lands on the worktree's root, not on a subfolder the session was in.
- Refused while the session, or a session it started, is working (`host.sessionWorking`). The check
  and the move are two steps: a message sent in the same instant can still start a run that the
  move then reaches.
- A background command the agent started keeps the folder it began in.
- The core change (`setSessionCwd`) needs a server restart; the extension itself reloads live.
