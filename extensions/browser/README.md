# Browser

Gives Pi a real Chromium on this machine, and shows you the same page in a Browser panel in the
right sidebar.

## Usage

Pi drives the page with the `browser` tool. You can click and type in the panel too.

One tool with sixteen actions: `navigate`, `snapshot`, `screenshot`, `click`, `type`, `press`,
`select`, `hover`, `scroll`, `wait`, `evaluate`, `console`, `back`, `forward`, `reload`, `viewport`.

- `snapshot` lists the page's text and controls with refs (`[e12]`). `click`, `type`, `select` and
  `hover` take a ref, a CSS selector or a visible label.
- `navigate` takes an http(s) URL, `host:port`, or a path to a file on this machine.
- `viewport` takes `mobile` (390×844), `tablet` (820×1180), `desktop` (1280×800, the default) or
  `WIDTHxHEIGHT`. The first two act as a touch device.

## Configuration

- `PI_DURABLE_BROWSER`: path of the browser to run. Without it, Chromium, Chrome, Brave or Edge where
  they are usually installed. With none found the tool says so.
- `PI_DURABLE_BROWSER_ARGS`: extra launch flags.

## Behavior

- The browser runs headless with its own profile, driven over the DevTools protocol through a pipe.
- The panel fetches frames only while its tab is in front; the screencast stops 15 seconds after.
- Dialogs (`alert`, `confirm`) are accepted at once and noted in the page's console log (`console`
  action), because nobody can answer one in a headless page.
- Each session's page address and viewport are saved in `browser/saved.json` in the data directory
  and come back when the page opens again.

## Limits

A call is not replayed after a restart (clicking twice is not harmless), and the page does not
survive one; only its address does.

The page driver is ported from Pi Pocket; the notice is in `server/NOTICE.md`.
