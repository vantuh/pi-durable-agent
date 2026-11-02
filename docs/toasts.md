# Shared UI notifications

The shell mounts one `Toaster` at the app root. This is core UI infrastructure, not a
feature-specific extension: notifications must survive closing a sidebar or changing a session.
Features can import `toast` from `web/src/lib/toast.ts` and show a message, success, error or
promise notification, optionally with a description and action.

Use Sonner (the shadcn toast choice) for animation, stacking, accessible announcements, timeout
pausing on interaction, dismissal and reduced-motion handling rather than a second home-made
notification lifecycle. This is the reason for the `sonner` dependency. Its visual skin is disabled;
our wrapper uses only the existing theme roles, including on light themes.

Session notices are the one exception to bottom-centre: when another session's run ends, or when
an extension has something to say about another session (a bash command killed by its timeout,
say), a toast with that session's title and a line about it appears top-right, below the panel
headers, for six seconds; a click anywhere on it opens that session. The session on screen gets
none, and the transcript there already says what happened. See [sessions-live.md](sessions-live.md).

These notices arrive on the session list stream, the one every tab holds whether or not it shows a
session, so a tab on the home page hears about a session it is not looking at. A notice about the
app itself, such as an extension that reloaded, keeps to the conversation streams and the bottom
centre. The shell filters by the session on screen and renders the rest: `web/src/lib/notice.ts`
decides, `web/src/shell/session-alert.tsx` draws. Each toast is given an id, so dismissing one
never dismisses the ones beside it.

Notifications appear bottom-centre, respect the mobile safe area, close automatically after three
seconds and can be dismissed manually. Archive notifications last four seconds to allow Undo.
Undo reports pending, success or failure through the same global host. Failed writes never show
success. The sidebar no longer reserves space for these messages.
