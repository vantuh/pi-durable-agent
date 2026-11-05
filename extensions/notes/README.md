# Notes

`extensions/notes` is a personal scratchpad and to-do list per repository, the two tabs of the Notes
panel. The agent never sees them: the extension has no tools, prompt sections or hooks.

- **One note per repository.** The key is the main worktree found through `git rev-parse
  --git-common-dir`, so every worktree and subfolder of a repository shares one note; a folder outside
  git uses itself. A session without a folder has no note.
- **Where it lives.** `notes/<repository-name>-<hash of its path>.md` in the data directory — never
  in the project, so it is never committed. A missing file is an empty note. The note is plain text,
  saved as you type; it is not rendered as Markdown.
- **To-dos** are `{ id, title, description, done }` in `<same name>.todos.json`, in the order they
  were dragged into (by the grip, so a phone still scrolls and taps). A checkbox strikes one through
  and folds it into Done; a tap on the title opens its title and description for editing; delete is
  immediate, with Undo in its toast. Each change is its own action (`addTodo`, `updateTodo`,
  `moveTodo`, `removeTodo`, `restoreTodo`) applied in the server's queue and answered with the whole
  list, so two tabs never overwrite each other. No priorities, dates, tags, archive or trash.
- **Checkboxes moved once.** The first read of a repository's to-dos, when it has no list yet, moves
  the note's `- [ ] title` / `- [x] title` lines into it and out of the note. Checkboxes typed
  into the note later stay text.
- **Conflicts.** `write` carries the content hash it was based on and is refused when the file has
  changed since (another tab or device). The panel then offers to load the newer text or overwrite
  it with yours. A panel with no unsaved edits re-reads the note when the window gets focus.
- **The badge** on the Notes tab counts the open to-dos.
