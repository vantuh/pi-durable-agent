# Git history & review

A **Git history** page in place of the conversation, with a header badge for uncommitted changes and
Push, and an embedded Plannotator review of a commit or the working tree. It runs in the selected session's working folder, never a browser-supplied path.

## Usage

The page has no tab in the right sidebar (`tab: false`). The header badge opens it, or
`ctrl+a g` with [hotkeys](../hotkeys/README.md) enabled (the shell command
`extension.git-history.open`, rebindable in `data/hotkeys.json`).

### History list

The branch, last-fetch ahead/behind counts, incoming commits, and the newest 50
local commits; **Load older commits** goes up to 200. Uncommitted changes appear above the commits. A row
shows the subject and `sha · author · time`, and opens the commit as a sub-page
(`?page=git-history:history&sub=<sha>`, or `sub=working`). Refresh reads local Git only; it never
fetches.

### Commit page

The subject, full message, sha, author and local date, the actions, a file summary
and the diffs.

- Diffs use the core's shared `web/src/ui/diff/` Pierre renderer, role theme, Highlights backend and word highlighting. Each
  file has a sticky header with its line counts; clicking it folds the file (200 ms; a reduced-motion
  setting folds at once). Files start expanded.
- On a wide screen a changed-files column sits beside the diff with folders and per-file counts.
  Clicking a file unfolds it and scrolls to it. Drag the column's right edge (or press the arrow keys on
  it; double-click resets) to resize it between 160 px and the sidebar's maximum; it cannot be hidden. The
  width is saved in this browser. A phone, or a change of one file, shows the diff alone.
- Untracked non-ignored files are included. Binary files are listed without a text diff.
- **Settings → Appearance → Diffs** chooses **Unified** (default) or **Side by side** for both history
  previews and edit output. Narrow viewers use Unified regardless of the saved choice. The setting is
  saved in this browser and applies to all sessions. A previous history-only choice is kept only when
  Appearance has no saved layout. Plannotator's layout is controlled inside its own UI.

### Reword

On a commit's page, a form with the current title and description. It is shown only for a
commit the upstream cannot reach: not incoming, and either unpushed or on a branch with no upstream.
Saving rewrites that commit's message and writes every later commit on the checked-out branch again
with the same trees, authors and messages, so those commits get new ids while the files stay as they
are. The index and working tree are never touched. The branch moves with a compare-and-swap on its
old id, so a branch that changed meanwhile fails the save; the reflog keeps the old history. Git's own
refusal (a pushed commit, a commit of another branch) is shown in the form.

### Review

Click **Review**. The server launches the installed `plannotator` CLI with browser
opening disabled, and its UI fills the page body at `<sha>/review` (or `working/review`).

- Uncommitted changes use Plannotator's native Git mode with full-file context. This is a **live**
  review: an agent or terminal can change the working tree while it is open. Git actions inside that
  UI can modify the index; this extension's own history reader never changes Git state.
- A selected commit uses a static patch against its **first parent** (a root commit against the empty
  tree). Static-patch mode has no full-file expansion, image/Markdown previews, staging or
  Git-context switching.
- Send feedback or approve inside Plannotator. The CLI's `decision` and rendered `message` return to
  this session. Nonempty feedback is **appended to the composer**, preserving existing text, once per
  review per page lifetime, and the history page closes. It is **not sent to the model**. Closing
  without feedback adds nothing.
- The frame's back arrow returns to the commit without stopping the process; **Resume review**
  returns to it. **Cancel review** (list toolbar or the review's header) stops it and shows errors.
  Leaving the history page (close button, browser Back, opening another session) asks the server to
  cancel an active review, including one still starting; a failed cancel is not shown.

### Header badge and push

A rounded `+added −deleted ↑ahead ↓behind` badge in the
[header slot](../../docs/extensions.md#header-items). It opens the page at uncommitted changes
(`sub=working`) while there are changed lines, and the list otherwise.

- Line counts compare the whole working tree with HEAD (staged and unstaged), including untracked,
  non-ignored files. A replaced line is one deletion and one addition. Binary files add no counts.
- An initial branch without commits works. Outside a working-tree repository the badge draws nothing.
- In an ordinary checkout, commit counts compare with the configured upstream as of the **last
  fetch**; nothing fetches or pulls automatically. Without an upstream the counters show `?` and Push
  is disabled.
- In a **linked worktree**, the arrows compare HEAD with the branch the main checkout has checked out
  **now**: ↑ commits here that branch lacks, ↓ commits of that branch missing here. Both come from
  local refs. A main checkout on a detached or unborn HEAD, or a bare one, offers no base, so the badge
  keeps the upstream arrows. The badge's title names the branch it compares with. Push is unaffected.
- **Push** asks for confirmation, rechecks the branch on the server and sends only HEAD to that
  branch's configured upstream. No force, tag following or recursive submodule pushes, no automatic
  commit, upstream creation or pull/rebase. A behind or diverged branch must be reconciled in Git
  first. 60-second timeout, terminal credential prompts disabled (configure credentials beforehand).
  Failures show in the header popover and can be dismissed.

### Keys

| Where    | Key                    | Does                                                            |
| -------- | ---------------------- | --------------------------------------------------------------- |
| The list | `ArrowDown`, `ArrowUp` | moves the cursor one row, wrapping at both ends                 |
| The list | `Enter`                | opens the commit under the cursor                               |
| The list | `Escape`               | back to the conversation, with the caret in the composer        |
| A commit | `ArrowDown`, `ArrowUp` | scrolls the diff a couple of lines, stopping at its top and end |
| A commit | `Escape`               | back to the list, with the cursor on the commit just read       |
| A review | `Escape`               | back to its commit, as the frame's Back, without stopping it    |

The cursor starts on the commit last read in this folder, or the first row. Keys are left to whatever
holds the keyboard: a field being typed into, an open dialog or popover, a form, the terminal, an
input method mid-word, and any press a nearer component has already answered.

## Configuration

Requires `plannotator` on the **server process's PATH**. Remote Git checks and automatic CLI updates
are disabled for these processes; other Plannotator features follow the user's own configuration, and
its optional AI/provider actions are separate from merely opening a review.

## Behavior

- **Limits on size.** The read-only preview stops at 400 KiB of diff: files that fit keep theirs, the
  rest are listed without one. At most 500 untracked files are included, with a notice when there are
  more. New symlinks are listed but never followed outside the checkout. A review patch over 8 MiB
  is refused rather than cut.
- **Processes.** One review process per session. Startup times out after 45 seconds; a running review
  expires after two hours. Disabling, removing or reloading the extension, or stopping the server,
  stops them. Review and decision tracking resets on server restart. Plannotator's own drafts and
  preferences follow its installed configuration. Composer drafts survive session switching, not a
  page reload.
- **Badge freshness.** Each `stats` call leases its session for three minutes; the browser's
  once-a-minute call renews it. While any lease is held, the server reads each leased folder every
  3 s and, when the numbers differ, calls `host.notifySessionChanged` for that folder's sessions, so
  the badge re-reads through `session.revision`. With no lease there is no Git work, and a reload
  stops the poller. Counts also refresh after agent activity and after a push.
- **A commit opens without waiting.** A commit cannot change, so it is cached in layers; only the
  working tree is read every time.

    | Layer       | Kept                                                         | Where             |
    | ----------- | ------------------------------------------------------------ | ----------------- |
    | prefetch    | the newest three commits, on idle; any row on hover or focus | `web.tsx`         |
    | patch       | 20 commits per browser tab                                   | `web.tsx`         |
    | parsed diff | 10 patches per browser tab                                   | `web/preview.tsx` |
    | patch       | 20 commits per server process                                | `server.ts`       |

    Reading one commit costs three Git processes (the repository root is remembered per process, the
    commit and its first parent come from one `rev-list`, and the title is not read). New files in the
    working tree cost two processes each, read eight at a time.

- **Layout.** The diff view is the detail page's scroller. It mounts only the files near the viewport,
  and the changed-files column is its sibling. The file header is our own 36 px row, and
  `itemMetrics.diffHeaderHeight` must say the same, or a jump to a file lands a header's height off.
- **File tree and icons.** `@pierre/trees` builds and virtualizes the changed-files tree, with
  its `complete` built-in SVG icon set and keyboard navigation. Click a file, or focus it and press
  Enter, to unfold and scroll to its diff. Counts are row decorations. `web/file-tree.css` maps
  the tree's colors and typography to the app's theme. If a diff replaces file `a` with directory
  `a/`, the old file appears as `a (file)`; its click still opens the original diff. Diff headers
  reuse the same library's icon resolver and one document-level SVG sprite, colored by the tree's own
  icon-token pairing (`web/file-tree.css`). No custom icon font, file-type map, rename, drag and drop, or filesystem writes.

- **Embedding and security.** The CLI binds loopback. The iframe loads an opaque, random per-review
  URL under `/api/extensions/git-history/http/<capability>/`. HTML, API, SSE and binary traffic go
  through this server, so a phone uses the app's existing HTTPS origin rather than the computer's
  localhost. A small injected adapter rebases Plannotator's root-relative fetch, XHR, EventSource,
  beacon and resource URLs to that namespace. The raw HTTP seam is not a WebSocket-upgrade API;
  Plannotator's review uses SSE. HTML is gzip-compressed when accepted. Unknown or ended capabilities
  return 410, and caller-supplied upstream hosts and ports are never accepted.
- Core rejects foreign Origin / Fetch-Site requests before calling raw extension HTTP handlers or
  extension actions. The proxy reanchors accepted origins to the fixed upstream and forwards only
  `plannotator-*` preference cookies. Plannotator's response cookies are restricted to its own
  namespace, and framing is restricted to the app itself. Vite preserves Host; production reverse
  proxies must preserve the public Host too.

## Limits

- The iframe holds a **trusted installed program**, not untrusted content. Scripts and same-origin
  storage are necessary for it to work, so its sandbox is not a security boundary from the app (it
  does block top-level navigation). Never embed an arbitrary website through this proxy.
- The adapter is tested against Plannotator 0.28.27, not a stable embedding API. Recheck transports
  and resource URLs after a CLI upgrade.
- Trees is pinned to `1.0.0-beta.6`. Its theming dependency declares an optional `@pierre/theme`
  v1 peer while the app has v2, so pnpm reports a peer warning. This integration uses explicit CSS
  variables, not that dependency's theme-loading helpers.
- Mobile Chromium viewport testing is not a substitute for a physical iOS/Android keyboard,
  clipboard and file-upload test.

The commit rewrite in `server/git.ts` and the Reword form are ported from pi-pocket's
`extensions/git-history` (MIT, `LICENSE.pi-pocket`).
