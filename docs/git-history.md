# Git history and embedded review

`extensions/git-history` adds **Git history**, a page in place of the conversation: the list is its
root and a commit is a sub-page. It has no tab in the right sidebar (`tab: false`); the header badge
(`+added −deleted ↑ahead ↓behind` and Push, see
[Header items](extensions.md#header-items-and-git-statistics)) is the way in, and the same folder
serves the badge's counts and push. It runs in the selected session's working folder, not a
browser-supplied filesystem path.

## Workflow

- Open Git history to see the branch, last-fetch ahead/behind counts, incoming commits, and the newest
  50 local commits in a toolbar and a list. Load older commits up to 200. Refresh reads local Git
  only; it never fetches.
- Uncommitted changes appear above the commits. A row shows the subject and `sha · author · time`;
  the whole row is a button, and it opens the commit as a sub-page (`?page=git-history:history&sub=<sha>`,
  or `sub=working` for the working tree). The list slides out to the left as the detail slides in from
  the right; browser Back or the frame's back arrow plays it in reverse and the list keeps its
  scroll position and the keyboard on the row that was opened.
- The detail page shows the subject, the full message, the sha, author and local date, the actions,
  a file summary and the diffs. It has one scroll for the whole page: the diff view itself is the
  scroller, so no part of a diff scrolls by itself. Only the files and lines near the viewport are
  mounted, and the read-only 400 KiB cap below bounds the text. A commit's diff cannot change, so
  reopening it is a cache hit; the working tree is read again every time.
- A commit's diff is rendered by `@pierre/diffs`, with line numbers, syntax and word-level
  highlighting. Each file has its own sticky header with its line counts: it pins to the top of the
  page scroll while that file is under it, and clicking it folds the file under that header. The
  fold takes 200 ms and the files below move with it rather than after it; a reduced-motion setting
  folds at once. Files start expanded. Every file carries a mark for its kind. On a wide screen a
  changed-files column sits beside the diff, with its folders and per-file counts: clicking a file
  unfolds it if it was folded and scrolls the diff to it. A phone, or a change of one file, shows
  the diff alone.
  Untracked non-ignored files are included; binary files are listed without a text diff.
- In **Settings → Extensions → Git history & review**, choose **Unified** (the default) or
  **Side by side** for history previews. The choice is saved in this browser, applies to all
  sessions and updates open previews. Plannotator's layout is controlled inside its own UI.
- Click **Review**. The server launches the installed `plannotator` CLI with browser opening
  disabled. Its real UI fills the page body at `<sha>/review` (or `working/review`), not a new tab;
  the frame's back arrow returns to the commit without stopping the process.
- Uncommitted changes use Plannotator's native Git mode, with full-file context and its normal
  Git-aware features. This is a **live** review: an agent or terminal can change the working tree
  while it is open. Plannotator controls its refresh/staleness UI. Git actions inside that UI can
  modify the index; our history reader itself never changes Git state.
- A selected commit uses a static patch against its **first parent** (a root commit against the
  empty tree). No checkout or history rewrite. Static-patch mode has no full-file expansion,
  image/Markdown previews, staging or Git-context switching. The patch is never silently cut to
  fit: patches exceeding 8 MiB are refused.
- Send feedback / approve inside Plannotator. The CLI's `decision` and rendered `message` return
  to this session. Nonempty feedback is **appended to the composer**, preserving existing text,
  once per review per page lifetime, and the history page closes so the person lands in the chat
  with the draft. It is **not sent to the model**. Closing without feedback adds nothing.
- **Reword** on a commit's page opens a form with the current title and description. It is shown
  only for a commit the upstream cannot reach: not an incoming commit, and either unpushed or on a
  branch with no upstream. Saving rewrites the message of that commit and writes every commit
  after it on the checked-out branch again with the same trees, authors and messages, so those
  commits get new ids while the files stay exactly as they are, and the page returns to the list.
  The index and the working tree are never touched; no dirty-tree guard is needed. The branch moves
  with a compare-and-swap on its old id, so a branch that changed meanwhile fails the save instead
  of losing a commit; the reflog keeps the old history. Git's own refusal (a pushed commit, a commit
  of another branch) is shown in the form. This is the only Git write in this extension; it still
  never fetches, checks out or pushes.

The read-only history preview stops at 400 KiB of diff: the files that fit keep theirs, the rest are
listed without one, and no file is dropped from the list. New symlinks are listed but never followed
into files outside the checkout.

## Processes, settings and limits

Requires `plannotator` on the **server process's PATH**. Tested with 0.28.27. No skill or model call
is involved in opening Review. The read-only preview uses `@pierre/diffs`; the interactive
review UI still comes from the installed CLI, not a bundled Plannotator package.

One process per session. Leaving the history page — its close button, browser Back, or opening
another session — asks the server to cancel an active review, including one still starting; the page
is already gone when the answer comes, so a failed cancellation is not shown. **Cancel review** in
the list toolbar or the review's own header stops it explicitly and shows the error. The back arrow
only hides the iframe; **Resume review** returns to it without stopping the process. Disabling, removing or
reloading the extension, or stopping the server, stops its processes. Startup times out after 45
seconds; a running review expires after two hours.
Session/decision tracking is ephemeral and resets on server restart. Plannotator's own drafts,
preferences and feedback history follow its installed configuration. The app's composer drafts
currently survive session switching, not a page reload.

Remote Git checks and automatic CLI updates are disabled for these processes. Other Plannotator
features follow the user's configuration; optional AI/provider actions inside its UI are separate
from merely opening a review and can invoke their own tools when explicitly requested.

## Why a commit opens without waiting

A commit cannot change, so three layers answer for it and only the working tree is read again on
every look:

| Layer                    | Kept                                                         | Where         |
| ------------------------ | ------------------------------------------------------------ | ------------- |
| prefetch                 | the newest three commits, on idle; any row on hover or focus | `web.tsx`     |
| patch                    | 20 commits per browser tab                                   | `web.tsx`     |
| parsed diff and grammars | 10 patches per browser tab                                   | `preview.tsx` |
| patch                    | 20 commits per server process                                | `server.ts`   |

A click on a prefetched commit is the mount of the diff view and nothing else. Reading one commit
costs three Git processes: the repository root is remembered per process, the commit and its first
parent come from one `rev-list`, and the title is not read at all — the list the client already has
says what each commit is called. New files in the working tree cost two processes each, so they are
read eight at a time.

The diff view is the detail page's scroller: it measures the box between the page frame and the
bottom and mounts only the files near it, so the diff does not scroll inside another scroll box.
The changed-files column is a sibling of that scroller, not a wrapper around it.
The preview's file header is our own row, 36 px tall, and `itemMetrics.diffHeaderHeight` says the
same. A header of another height leaves every file below it a little too low and a jump to a file a
header's height off.

The marks beside a file name are Nerd Font glyphs — 27 of them, 6.6 KB — subsetted from the
JetBrains Mono Nerd Font an editor uses, so a file's header shows the same picture a terminal does
without an icon package. The colour is a theme role picked by family: `text-info` for TypeScript,
`text-agent` for components, `text-warn` for JavaScript and JSON, `text-accent` for styles and
media, `text-ok` for shells, `text-spark` for config and data, `text-ember` for markup, SQL and
Rust. A kind of file that has no mark yet falls back to plain lines; a new one goes into
`icons.tsx` and the subset is rebuilt:

```bash
uvx --with fonttools --with brotli python -c "
from fontTools import subset
subset.main([
    '/Users/vantuh/Library/Fonts/JetBrainsMonoNLNerdFont-Regular.ttf',
    '--unicodes=e628,e60c,e625,e73e,e64e,eb0f,e615,e8eb,e672,e614,e60e,e691,e706,e60d,e698,e6a0,e606,e724,e68b,e66d,e608,e605,e699,e634,e620,e650,f0fc3',
    '--output-file=extensions/git-history/icons.woff2',
    '--flavor=woff2', '--no-hinting', '--desubroutinize', '--layout-features=', '--drop-tables+=DSIG',
])
"
```

## Embedding and security

The CLI binds loopback. The iframe loads an opaque, random per-review URL under
`/api/extensions/git-history/http/<capability>/`. HTML and API/SSE/binary traffic go through our
server, so a phone uses the app's existing HTTPS origin, not the computer's localhost or another
exposed port. Serving the app to a physical phone still requires the app's normal secure network
access; the extension does not publish the app itself.

A small injected adapter rebases Plannotator's root-relative fetch, XHR, EventSource, beacon and
resource URLs to this namespace. Current Plannotator review uses SSE; the raw HTTP seam is not a
WebSocket-upgrade API. HTML is gzip-compressed when accepted. Unknown/ended capabilities return
410, and arbitrary caller-supplied upstream hosts/ports are never accepted.

Core rejects foreign Origin / Fetch-Site requests before calling raw extension HTTP handlers or
extension actions. The proxy reanchors accepted origins to the fixed upstream and forwards only
`plannotator-*` preference cookies, never app authorization or unrelated cookies. Plannotator's
response cookies are restricted to its own namespace. Framing is restricted to the app itself.
Vite preserves Host, and production reverse proxies must preserve the public Host too.

The iframe contains a **trusted installed program**, not untrusted content. Scripts and same-origin
storage are necessary for it to function; its sandbox is not a security isolation boundary from
the app. It does block top-level navigation. Never embed an arbitrary website through this proxy.

The adapter is tested against 0.28.27, not a stable upstream embedding API. Recheck transports and
resource URLs after a CLI upgrade. Mobile Chromium viewport testing is not a substitute for a
physical iOS/Android keyboard, clipboard and file-upload test.
