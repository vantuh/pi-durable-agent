# Session delete

Archiving hides a conversation and can be undone; deleting is the other action in the same row menu
and cannot. The row's ellipsis offers Rename, Archive / Restore and Delete; Delete asks first — one
small panel with No and Yes, delete — and only then removes the row.

pi-durable has no delete: conversations and entries are immutable records and `Storage` only appends.
So the rows are removed from SQLite directly, which is safe only while no harness holds them. The
deleted id is written to `data/deleted.json`, hidden from the list and from `/api/events` at once, and
purged at the next start of the server, before `Harness.open`. Between the two, the transcript is
still on disk but unreachable; a restart finishes the job. `server/purge.ts` does both halves.

The purge deletes the conversation, its entries, tasks and submissions, its conversation- and
task-scoped documents, and the revisions of those documents. Nothing in this app forks a conversation
or spawns one from a task, so one id is all of it — a future feature that does either has to extend
this. The id stays in `record_ids`; ids are never reused, so it only keeps the namespace monotonic.

This belongs in the core for the same reason archiving does: session persistence and the sidebar list
are core responsibilities, and there is no extension slot for row actions.
