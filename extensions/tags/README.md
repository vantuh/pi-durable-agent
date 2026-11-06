# Tags

`extensions/tags` lets you name sessions with tags you make yourself, and shows them in the
session list.

- **Making tags.** The Tags row of the Extensions dialog (`details.tsx`): create a tag with a name and
  a colour, rename or recolour it, drop it. A name is one line of at most 24 characters and may not
  repeat another tag's name, ignoring case. The colour is one of eight theme hues (`red`, `peach`,
  `yellow`, `green`, `teal`, `blue`, `mauve`, `pink`).
- **Putting them on a session.** A session's menu has a Tags submenu with a checkbox per tag; it
  stays open so several can be set at once. A session row shows its first tag and `+N` for the rest.
- **Filtering.** The sidebar's list has a tag filter: it keeps every session that carries at least
  one chosen tag. A chosen tag that is later dropped stops filtering.
- **A tag has an id.** Renaming or recolouring keeps the sessions that carry it. Dropping a tag takes
  it off every session.
- **Storage.** `tags.json` in the data directory, `{ tags: [{ id, name, color }], sessions: { "<id>":
  [tagId] } }`, shared by every device that opens the app. A missing or broken file means no tags;
  an entry that names a tag that is not there is dropped when the file is read. Changes to the file
  are serialised, so two quick clicks do not overwrite each other.
- **Actions** (in `refs.ts`): `state`, `create`, `rename`, `recolor`, `remove`, `toggle`. `toggle`
  needs the session the call came from.

Limits: a tag has no meaning to the agent; it is a label for you. There is no nesting, ordering or
bulk edit.
