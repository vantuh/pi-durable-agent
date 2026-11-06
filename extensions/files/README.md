# Files

`extensions/files` is a read-only file viewer for the session's folder: a Files panel in the right
sidebar with a tree and a text viewer. There is no write action, on purpose. The limits and the
binary check come from Pi Pocket's `src/server/files.ts` (MIT).

- **Actions.** `list` (a folder's entries, folders first, then by name) and `read` (a file), both
  with a `path` relative to the session's folder. Without a session that has a folder they fail.
- **Inside the folder only.** The path is resolved with `realpath`; one that leaves the session's
  folder, also through a symlink, is refused, and so is an absolute path or one with a NUL byte.
- **Limits.** A folder lists at most 1000 entries, cut after the sort, so the first names survive. A
  file shows its first 512 KiB, with a note when there is more.
- **What a file is.** Text is shown with syntax highlighting. An image (by extension), a binary
  file (a NUL byte in the first 8000 bytes) and anything that is not a regular file (a pipe, a
  device) is named with its size and not shown.
- **Configuration.** None. Turn it off with its switch in the Extensions dialog.
