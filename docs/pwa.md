# PWA

The app installs from a browser and opens its shell offline. Nothing else works offline: a
conversation needs the server and its API.

## Why it is core

The manifest, `theme-color` and the worker belong to the document and the build, not to a panel.
An extension UI slot cannot reach them. All of it is in `pwa.ts` (a Vite plugin), `web/sw.js`
(the worker template) and `web/src/lib/register-worker.ts`.

## What the build emits

- `manifest.webmanifest`. Its colours come from the Mocha palette through the `--role-canvas` and
  `--role-panel` roles. No colour is written twice. Its name is `Pi`; the document title starts as
  `Pi` and, while a conversation is open, is `Pi · <session>` (`web/src/App.tsx`).
- `sw.js`. It has a version (a hash of the worker, manifest, built HTML, precache list and icon bytes) and a precache list: `/`, the entry chunk with
  its static imports, CSS, and the icons. Lazy chunks (Shiki itself, its languages and themes) and
  the two mono font files are not precached: the browser fetches them on first use and its HTTP
  cache (`immutable`) keeps them. Offline, before they were ever fetched, mono text falls back to
  the system mono font.
- Icons are in `web/public/icons/`, made from `web/public/favicon.png`. The `maskable` icon is
  opaque and padded. The favicon is 128 px, so the 512 px icons are enlarged and soft.

## Worker policy

- Navigation to `/` goes to the network first. Offline, the precached `/` is the answer.
- `/assets/*` comes from the precache, otherwise from the network.
- Everything else is not touched: `/api` (events, uploads, conversation data), other origins and
  non-GET requests. Nothing from the API enters Cache Storage.
- No `skipWaiting`. A new worker waits until all tabs close, so an update never reloads a live
  conversation. After activation it deletes older `pi-durable-agent-shell-*` caches and no others.
- Registration happens only in a production build. A failed registration logs a warning.

## Try it

```bash
pnpm build && pnpm preview
```

A worker needs HTTPS or `localhost`. `pnpm dev` does not register a worker, so Vite's HMR is never
cached. Tests: `test/pwa.test.ts` runs the real `web/sw.js` against a fake Cache Storage.

## Push

The worker also carries the `assets/sw.js` of each extension folder; today that is `extensions/push/assets/sw.js`,
which shows push notifications and opens the conversation on a click
([Push notifications](../extensions/push/README.md)). The core worker has no push code.
