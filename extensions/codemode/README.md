# Code mode

Installs Pi Durable's own `codemode` extension next to every other tool. The model writes a
JavaScript script that calls its tools as `await tools.<name>(args)` in a QuickJS sandbox
(`@earendil-works/pi-codemode`, 256 MiB); only the script's output reaches it.

## Usage

The model keeps all its other tools (`modelTools` is not set). In the transcript, a `codemode`
call's `code` shows as highlighted JavaScript instead of JSON with escaped newlines (`web.tsx`).

## Behavior

- A script survives a restart: it resumes where it was, without repeating finished calls.
- The `codemode` prompt section lists tool declarations up to 3000 tokens, and only when the
  `codemode` tool is offered.
- The sandbox closes when a version is replaced or the folder goes, once its running script
  finishes on it, and at once when the server stops. A script a restart interrupts is not failed; it
  replays on the next process's sandbox.
- `@earendil-works/pi-codemode` is a direct dependency, pinned to the version `pi-durable` uses.
