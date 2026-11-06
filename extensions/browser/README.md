# Browser

`extensions/browser` gives Pi a real Chromium on this machine, and gives you the same page in a
Browser panel in the right sidebar. Pi drives it with the `browser` tool; you can click and type in
the panel too.

- **The tool.** One `browser` tool with sixteen actions: `navigate`, `snapshot`, `screenshot`,
  `click`, `type`, `press`, `select`, `hover`, `scroll`, `wait`, `evaluate`, `console`, `back`,
  `forward`, `reload`, `viewport`. `snapshot` lists the page's text and controls with refs
  (`[e12]`); `click`, `type`, `select` and `hover` take a ref, a CSS selector or a visible label.
  `navigate` takes an http(s) URL, `host:port`, or a path to a file on this machine.
- **Which browser.** `PI_DURABLE_BROWSER` (a path), else Chromium, Chrome, Brave or Edge where they
  are usually installed. It runs headless with its own profile, driven over the DevTools protocol
  through a pipe. `PI_DURABLE_BROWSER_ARGS` adds launch flags. With none found the tool says so.
- **Viewports.** `mobile` (390×844), `tablet` (820×1180) and `desktop` (1280×800, the default).
  The first two act as a touch device.
- **Dialogs** (`alert`, `confirm`) are accepted at once and noted in the page's console log
  (`console` action), because nobody can answer one in a headless page.
- **Storage.** Each session's page address and viewport are saved in `browser/saved.json` in the data
  directory and come back when the page opens again.

Limits: a call is not replayed after a restart (clicking twice is not harmless), and the page does
not survive one; only its address does.

The page driver is ported from Pi Pocket; the notice is in `server/NOTICE.md`.
