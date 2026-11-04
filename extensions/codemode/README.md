# Code mode

`extensions/codemode` installs Pi Durable's own `codemode` extension next to every other tool: the
model writes a JavaScript script that calls its tools as `await tools.<name>(args)` in a QuickJS
sandbox (`@earendil-works/pi-codemode`, 256 MiB), and only the script's output reaches it. The
model keeps all its tools as well; `modelTools` is not set.

- A script survives a restart: it resumes where it was, without repeating finished calls.
- The extension's name is `codemode`, as the folder's, so no renaming was needed.
- The sandbox is closed when a version is replaced or the folder goes, once its running script
  finishes on it, and at once when the server stops. A script a restart interrupts is not failed: it
  replays on the next process's sandbox.
- `pi-codemode` is a direct dependency, pinned to the version `pi-durable` uses.
- Its `web.tsx` contributes a `toolViews` entry, so a call's `code` shows as highlighted JavaScript
  instead of JSON with escaped newlines.
