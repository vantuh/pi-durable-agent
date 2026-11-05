# Git worktrees

`extensions/git-worktree` puts a menu of the repository's worktrees in the folder picker, and a
`New worktree` checkbox with a name field beside it. The menu offers the folder as picked — the
main checkout, usually — and every worktree the repository already has, made by this server or by
hand; the two are one answer, so ticking the box puts the folder back and picking a worktree unticks
it. The choice belongs to the folder it was made for: browsing anywhere else, and opening the picker
again, starts from the picked folder. Open then starts the session **in** the worktree chosen, or
in a new one, so two sessions can work on the same repository without stepping on each other's files.

- **Where it starts from:** the tip of the branch the folder is on, so local commits that were
  never pushed come with it. Uncommitted changes and new files do not: a worktree is a clean place
  to start. Ignored files would not be copied either way.
- **Where it goes:** `worktrees/<repository>/<name>` under the server's data folder, never inside
  your repository, so the folder you picked is left as it was. The repository's own name is the
  folder even when the picker is open inside a worktree.
- **The name** is slugified (lowercase, letters, digits, `.`, `_`, `-`, at most 40 characters) and
  is both the folder's name and the new branch's. A name that is a branch already, or a folder that
  is there already, refuses with a message under the picker.
- **The menu** lists checkouts, not folders: `git worktree list` of the picked folder's repository,
  the checkout the folder is in marked as the one picked, and a worktree whose folder is gone — or
  that is no checkout at all, as a bare repository is — left out. Its first item is the folder as
  picked, named `Main checkout` when that is the repository's own, so a folder inside a linked
  worktree is offered under the worktree's own name. A worktree may hold a file where the picked
  folder is a folder, and then the menu offers the worktree itself, not that name inside it. The
  menu is cut to the screen, so a long branch name is truncated instead of widening it.
- **The session folder keeps its place:** picking `packages/app` of a repository starts the session
  in `packages/app` of the worktree, whether it was made here or elsewhere.
- Refused: a folder in no repository, and a repository with no commit yet. The worktree's branch
  stays after the session is deleted, with whatever was committed on it; nothing removes it yet.
- **Beside the branch badge**, `extensions/git-worktree` shows the worktree the session works in,
  named by its folder — the worktree's own folder name, never the branch it happens to be on, so
  switching the branch in place does not rename it — and `Main checkout` for the repository's own
  folder. It is shown on a phone too, and only for a session whose folder is in a git repository.
- **The badge is the menu**: it lists the repository's worktrees, the one the session is in marked
  and every row named by its folder with its branch beside it, searched case-insensitively as you
  type over both the folder's name and the branch. Picking one moves the session there at once,
  keeping its place inside the repository (a session in `packages/app` lands in `packages/app` of the
  worktree) and appends `Worktree changed to <folder>` to the unsent draft, so the agent knows where
  it is now; nothing is sent for you. A name no listed worktree's folder or branch has offers
  `Create worktree "<slug>"`: it makes one under the data folder at the
  current commit — clean, exactly as the folder picker does — and moves the session into it, or into
  the worktree's root when the folder the session is in is not in the new worktree.
  The server reads the repository's list again on every move, so a folder of another repository is
  refused. Creation and moves are refused while the agent is running, with a second check before
  moving. If a run starts during creation, the new worktree stays but the session does not move;
  reopen the menu after the run ends to select it. The menu is a `Popover` with `Command` rows,
  as the branch badge's is, and cut to the screen.
- **The × beside the badge** — only on a worktree this server made — asks one question in a centred
  dialog: the folder, what goes with it, and that the branch stays. It then removes the worktree
  through the `remove` action. git removes it from the repository it belongs to, never from inside
  it: a shell there would be standing in the folder being deleted. The branch is kept, and so are its
  commits; a worktree with changes git would lose is **refused**, with git's own words shown in the
  dialog, and nothing is removed. A worktree someone made elsewhere is shown the same way, without
  the ×.
- **In the sidebar,** a worktree's sessions appear under their repository's folder in the folder
  menu, read through `folderGroup` and `mainCheckoutOf`; the answer is kept per folder until the
  extension reloads, and a repository with no checkout of its own — a bare one — is nobody's. A worktree this server made is remembered in `git-worktree.json` under the
  data folder as it is made, so its sessions stay under the repository after the worktree is gone
  and git has forgotten it. Turning `git-worktree` off makes them folders of their own again.
- **The folder picker** reads that same answer, the `under` of a session row: a session working in a
  worktree opens the picker at the repository's own checkout, and the `Recent` list keeps the
  repository rather than the worktree. The worktrees themselves are left out of the picker's lists
  through the option's `omit`, answered by the `linked` action: a folder whose `.git` is a file is
  the cheap test for a linked worktree, and `mainCheckoutOf` confirms it before the row is hidden.
  The menu is the `worktrees` action, git's own list of checkouts.
- **When the worktree is deleted under the session**, nothing of the session is lost: its row keeps
  the folder it was created in, the transcript stays readable, and the stream keeps working. What
  fails is work that needs the deleted folder: `bash` answers
  `Working directory does not exist: <folder>`. This is not a tool sandbox; calls using other
  existing paths can still work. Deleting a worktree from the terminal leaves the session like
  that, so the header shows the worktree's name in red — no menu, no ×, since there is nothing left
  there — with the session's own folder in its tooltip. It is read through the `state` action of
  `git-worktree`, again whenever the session's run state changes, so a worktree deleted while the app
  is open shows red at the next message, not at once.
