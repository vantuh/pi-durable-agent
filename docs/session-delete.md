# Session delete

Archiving hides a conversation and can be undone; deleting is the other action in the same row menu
and has no way back. The row's ellipsis offers Rename, Archive / Restore and Delete; Delete asks
first — one small panel with No and Yes, delete — and only then removes the row from every list.

Deleting writes nothing but a note: the `app.deleted` conversation document, default false, no
migration. The conversation, its entries and its documents stay in `data/state.sqlite` exactly as
they were; `Sessions.ids()` skips the marked ones, so they are absent from the sidebar, from the list
API and from the streams, also after a restart. `Sessions.open()` refuses them too, so a stale link
cannot bring one back.

This is deliberately a mark and not a purge. pi-durable has no delete call — conversations and
entries are immutable and `Storage` only appends — and removing rows underneath a running harness
would mean writing to the store behind the library's back, where any failed commit is fatal to the
session. A note is the whole difference and none of the risk; what it costs is that the bytes of an
old session stay on disk.

Taking a deleted session back would mean flipping the same document; nothing in the UI does, because
a delete that can be undone is an archive. To start clean, delete `data/state.sqlite`: it is the only
state, and every session goes with it.
