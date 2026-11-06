# Notes

A personal scratchpad and to-do list per repository, the two tabs of the Notes panel. The agent
never sees them: the extension has no tools, prompt sections or hooks.

## Usage

- **Note tab.** Plain text, saved as you type; it is not rendered as Markdown.
- **To-dos tab.** Add, edit and delete to-dos. Drag one by its grip to reorder (a phone still scrolls
  and taps). A checkbox strikes one through and folds it into Done. A tap on the title opens its
  title and description for editing. Delete is immediate, with Undo in its toast.
- **Badge.** The Notes tab counts the open to-dos.

## Behavior

- **One note per repository.** The key is the main worktree found through
  `git rev-parse --git-common-dir`, so every worktree and subfolder of a repository shares one note.
  A folder outside git uses itself. A session without a folder has no note.
- **Storage.** `notes/<repository-name>-<hash of its path>.md` in the data directory, never in the
  project, so it is never committed. A missing file is an empty note. To-dos are
  `{ id, title, description, done }` in `<same name>.todos.json`, in dragged order.
- **Actions.** Each to-do change is its own action (`addTodo`, `updateTodo`, `moveTodo`,
  `removeTodo`, `restoreTodo`), applied in the server's queue and answered with the whole list, so
  two tabs never overwrite each other.
- **Checkbox migration.** The first read of a repository's to-dos, when it has no list yet, moves
  the note's `- [ ] title` / `- [x] title` lines into it and out of the note. Checkboxes typed into
  the note later stay text.
- **Conflicts.** `write` carries the content hash it was based on and is refused when the file has
  changed since (another tab or device). The panel then offers to load the newer text or overwrite
  it with yours. A panel with no unsaved edits re-reads the note when the window gets focus.

## Limits

No priorities, dates, tags, archive or trash.
