# UI rework: flat, square, one extensions sidebar

A visual pass toward a plainer, developer-tool look, done on the `ui-rework` worktree. References: the
DeepSeek Harness desktop app (flush panels, one right-sidebar toggle) and
`/Users/vantuh/projects/opensource-test/ultimate` (`web/src/app/primitives.tsx`: panels split by 1px
borders, a 28px status line, a right panel with extension tabs).

Colours stay the Catppuccin roles; only which role a surface uses changed.

## Decisions

| Area             | Decision                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corners          | None. The `--radius-*` tokens and every `rounded-*` class are gone, dots and switches included.                                                                                                                  |
| Panels           | Flush: no gaps, no outer padding. One 1px `border-edge-soft` rule between regions. Sidebar, right panel, settings and status bar are `bg-panel`; the conversation is `bg-canvas`.                                |
| Status bar       | A flat footer across the whole width: `bg-panel`, `border-t`, `h-7`.                                                                                                                                             |
| Shadows          | Only on things that float: menus, popovers, tooltips, toasts, dialogs.                                                                                                                                           |
| Header           | The session title, the extension `header` items (git stats), and one `Extensions` toggle.                                                                                                                        |
| Right sidebar    | One tab per extension panel, then one per page (`web/src/shell/tabs.tsx`). A panel opens in the sidebar; a page fills the conversation area with the same tabs above it and keeps its `?page=` address and Back. |
| Composer         | Follows the transcript's width setting (`--chat-width`: comfortable, wide, full), so their edges line up.                                                                                                        |
| Person's message | A full-width block, `bg-panel`, with the accent stripe on the left, not a right-aligned bubble.                                                                                                                  |
| Sidebar top      | Row 1: title, new session, search, collapse. Row 2: folder, tag filter, archive. No rule above the first date group.                                                                                             |
| Fonts            | Sans for everything; JetBrains Mono only for code, diffs, paths, model ids and numbers. Mono chrome was tried and reverted: Cyrillic in JetBrains Mono reads wide and heavy.                                     |
| Text sizes       | Theme tokens in `web/src/styles/styles.css`: `meta` 12px, `ui` 14px (chrome: session titles, lists, tool rows), `interface`/`prose` 15px. `text-ui` replaced `text-sidebar` and `text-tool`.                     |

## Commits

| Commit    | Change                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `bcbebc5` | Square corners, flush panels, flat status bar                               |
| `bd90d18` | One extensions toggle; panels and pages as sidebar tabs                     |
| `aa47360` | A page reached by Back is never inert; a panel tab keeps focus in the panel |
| `3ce5774` | Composer follows the transcript's width                                     |
| `5f2ca2b` | Person's message as a full-width block with an accent stripe                |
| `6027020` | Sidebar top in two rows                                                     |
| `8b1bc15` | Mono chrome (reverted by `9d87dae`)                                         |
| `fb3deeb` | No rule above the first session group                                       |
| `ac71dfa` | Session titles back in sans (folded into `9d87dae`)                         |
| `9d87dae` | Chrome back in sans; mono only for code                                     |
| `4fa92d0` | One `text-ui` size (14px) for the chrome                                    |

## Open

- Two bottom bars: the session meta row under the composer (context, cache, tok/s, cost) and the
  status bar. Merging them touches the status items extensions contribute.
- Tag badges (`bugfix`, `unfinished`) are filled and loud in the session list; coloured text or a
  square dot would be quieter.
- The text scale could shrink to three sizes: `micro` into `meta`, `interface` and `prose` into one
  name. `micro` sits in tight places (a 14px count badge), so it needs checking first.
- Not checked: the Latte (light) flavour and tablet width.
- Older bugs seen on the way, not caused by this work: on a phone the status bar's start and centre
  cells overlap; React warns about a missing `key` in a `ForwardRef` list when a panel mounts.
