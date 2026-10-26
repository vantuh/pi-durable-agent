# Session archive

Archiving hides a conversation from the normal sidebar list without deleting it or stopping a run.
The sidebar switches between Sessions and Archive within the selected folder. Archived sessions
can still be opened by direct link, read and restored. Archiving the selected session leaves its
conversation open, so neither a running answer nor the folder context is lost.

This belongs in the core: session persistence and the sidebar list are core responsibilities, and
there is no extension slot for session metadata or row actions. Keep the metadata in a separate
conversation document (default false, no migration); do not change the harness's lifecycle state.
The list API returns both kinds and the browser filters them. The row's ellipsis opens a shadcn-style Radix dropdown menu (outside click and Escape
dismiss it), initially with only Archive / Restore. The shared component handles focus, keyboard
navigation and collision-aware positioning; its items fill the content width. This is why
`@radix-ui/react-dropdown-menu` is a direct dependency, like the existing Radix UI primitives. Rename is
not part of this change. A reversible archive offers Undo; failed writes stay visible as errors.
