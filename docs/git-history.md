# Git history and embedded review

`extensions/git-history` adds **Git history & review** (the history icon in the conversation
header). It runs in the selected session's working folder, not a browser-supplied filesystem path.
It is independent of `git-stats`: disabling either does not disable the other.

## Workflow

- Open History to see the branch, last-fetch ahead/behind counts, incoming commits, and the newest
  50 local commits. Load older commits up to 200. Refresh reads local Git only; it never fetches.
- Uncommitted changes appear above the commits. Click a row for a bounded diff preview
  rendered by `@pierre/diffs`, with line numbers, syntax and word-level highlighting. Each file has
  its own foldable header and line counts; files start expanded. Untracked non-ignored files
  are included; binary files are listed without a text diff.
- In **Settings → Extensions → Git history & review**, choose **Unified** (the default) or
  **Side by side** for history previews. The choice is saved in this browser, applies to all
  sessions and updates open previews. Plannotator's layout is controlled inside its own UI.
- Click **Review**. The server launches the installed `plannotator` CLI with browser opening
  disabled. Its real UI appears in a full-size dialog, full screen on phones, not a new tab.
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
  once per review per page lifetime. It is **not sent to the model**. Closing without feedback
  adds nothing. Return to the conversation to edit and send the draft yourself.
- **Pencil** on a commit row opens a small form with the current title and description. It is shown
  only for a commit the upstream cannot reach: not an incoming commit, and either unpushed or on a
  branch with no upstream. Saving rewrites the message of that commit and writes every commit
  after it on the checked-out branch again with the same trees, authors and messages, so those
  commits get new ids while the files stay exactly as they are. The index and the working tree are
  never touched; no dirty-tree guard is needed. The branch moves with a compare-and-swap on its old
  id, so a branch that changed meanwhile fails the save instead of losing a commit; the reflog keeps
  the old history. Git's own refusal (a pushed commit, a commit of another branch) is shown in the
  form. This is the only Git write in this extension; it still never fetches, checks out or pushes.

The read-only history preview is limited to 400 KiB. Oversized changes are listed without a full
preview. New symlinks are listed but never followed into files outside the checkout.

## Processes, settings and limits

Requires `plannotator` on the **server process's PATH**. Tested with 0.28.27. No skill or model call
is involved in opening Review. The read-only preview uses `@pierre/diffs`; the interactive
review UI still comes from the installed CLI, not a bundled Plannotator package.

One process per session. Closing the outer dialog (×, Escape or an outside click) cancels an
active review and waits for its process to stop, including a review still starting. If cancellation
fails, the dialog stays open with the error so it can be retried. **History** only hides the iframe;
**Resume review** returns to it without stopping the process. **Cancel review** in History also
stops it explicitly. The embedded viewer keeps only **History** in its title row; cancellation
is available inside Plannotator or by closing the outer dialog. Disabling/removing/reloading the
extension, or stopping the server, stops its processes. Startup times out after 45 seconds; a running
review expires after two hours.
Session/decision tracking is ephemeral and resets on server restart. Plannotator's own drafts,
preferences and feedback history follow its installed configuration. The app's composer drafts
currently survive session switching, not a page reload.

Remote Git checks and automatic CLI updates are disabled for these processes. Other Plannotator
features follow the user's configuration; optional AI/provider actions inside its UI are separate
from merely opening a review and can invoke their own tools when explicitly requested.

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
