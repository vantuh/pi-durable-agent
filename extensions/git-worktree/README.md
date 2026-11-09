# Git worktree

Starts a session in a git worktree of its own, or in one the repository already has, so two sessions
can work on the same repository without stepping on each other's files. It also moves an open
session between the worktrees of its repository.

## Usage

**Folder picker.** A menu of the repository's worktrees and a `New worktree` checkbox with a name
field. Open starts the session **in** the chosen worktree, or in a new one.

- The menu lists checkouts (`git worktree list` of the picked folder's repository), made by this
  server or by hand. Its first item is the folder as picked, named `Main checkout` when that is the
  repository's own. A worktree whose folder is gone, or that is no checkout (a bare repository), is
  left out. The menu is cut to the screen, so a long branch name is truncated.
- The menu and the checkbox are one answer: ticking the box puts the folder back, and picking a
  worktree unticks it. The choice belongs to the folder it was made for; browsing elsewhere, or
  opening the picker again, starts from the picked folder.
- The session keeps its place: picking `packages/app` starts the session in `packages/app` of the
  worktree.
- Worktrees themselves are left out of the picker's folder lists (the `linked` action; a folder
  whose `.git` is a file is the cheap test, and `mainCheckoutOf` confirms it). A session working in a
  worktree opens the picker at the repository's own checkout, and `Recent` keeps the repository
  rather than the worktree.

**Badge beside the branch badge.** It names the worktree the session works in by its folder (never
the branch, so switching branch in place does not rename it), or `Main checkout` for the repository's
own folder. It shows on a phone too, and only for a session whose folder is in a git repository.

- The badge is a searchable menu over folder name and branch. Picking one moves the session there at
  once, keeping its place inside the repository, and appends `Worktree changed to <folder>` to the
  unsent draft. Nothing is sent for you.
- A name no listed worktree has offers `Create worktree "<slug>"`: it makes one at the current
  commit and moves the session into it, or into its root when the session's folder is not in the new
  worktree.
- The × beside the badge, only on a worktree this server made, opens a dialog naming the folder, what
  goes with it, and that the branch stays. It removes the worktree through the `remove` action,
  run by git from the repository it belongs to, never from inside the folder being deleted. A
  worktree with changes git would lose is refused, with git's own words in the dialog. The branch and
  its commits are kept.

**Sidebar.** A worktree's sessions appear in their repository's folder group in the sidebar (read
through `folderGroup` and `mainCheckoutOf`; the answer is kept per folder until the extension
reloads). A bare repository is nobody's. Turning `git-worktree` off makes them folders of their own
again.

## Behavior

- **Where it starts from.** The tip of the branch the folder is on, so unpushed local commits come
  with it. Uncommitted changes and new files do not: a worktree is a clean place to start. Ignored
  files are not copied either.
- **Where it goes.** `worktrees/<repository>/<name>` under the server's data folder, never inside
  your repository. The repository's own name is used even when the picker is open inside a worktree.
- **The name** is slugified (lowercase, letters, digits, `.`, `_`, `-`, `/`, at most 40 characters)
  and is the new branch's name; `feat/header` is that branch. The folder's name is the same with each
  `/` turned into `-` (`feat-header`). A name that is already a branch, or a folder that is there
  already, is refused with a message under the picker.
- **Memory.** A worktree this server made is recorded in `git-worktree.json` in the data folder, so
  its sessions stay under the repository after the worktree is gone and git has forgotten it.
- **Refusals.** A folder in no repository, and a repository with no commit yet. The server reads the
  repository's list again on every move, so a folder of another repository is refused. Creation and
  moves are refused while the agent is running, with a second check before moving. If a run starts
  during creation, the new worktree stays but the session does not move.
- **When the worktree is deleted under the session**, nothing of the session is lost: its row keeps
  the folder, the transcript stays readable, and the stream keeps working. Work that needs the folder
  fails (`bash` answers `Working directory does not exist: <folder>`). The badge shows the name in
  red, without the ×, and still opens the menu: for a worktree this server made, its remembered
  repository supplies the list, so picking `Main checkout` moves the session out. Older worktrees
  without a record use remembered siblings under the same repository folder, only when their
  available checkouts agree on one repository. If no repository can be identified, or the main
  checkout is gone too, the menu has no choices. The badge reads the `state` action again whenever
  the session's run state changes, so a deletion shows at the next message, not at once.

## Limits

- The worktree's branch stays after the session is deleted, with whatever was committed on it;
  nothing removes it.
- This is not a tool sandbox: after a worktree is deleted, calls using other existing paths still
  work.
