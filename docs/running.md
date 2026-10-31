# Running it

## On the computer

`pnpm dev` runs the server on `127.0.0.1:8788` and Vite with HMR. `pnpm start` builds the shell and
serves it from the server alone.

## On the phone

The dev build is the wrong thing to load on a phone: about 170 requests and 15 MB of JavaScript to
parse, an HMR socket, and React's dev-mode double renders. The production build is about 50
requests and 1.6 MB to parse (measured on a mobile viewport, cold load).

```bash
pnpm preview:phone
```

It builds, then serves `dist/` with `vite preview --host --port 5192 --strictPort`. Open the
`Network:` address it prints, for example `http://192.168.31.210:5192/`. Vite's preview server uses
`server.proxy`, so `/api` (the event streams too) reaches the server on `127.0.0.1:8788`, which
keeps its address: only the preview listens on the network. The server must already be running.

- **No authentication.** Anyone on the same network can open the app and run tools on this machine.
  It is the same exposure as `vite --host` in development. Use a network you trust.
- **No service worker over plain HTTP.** A browser registers one only on HTTPS or `localhost`
  ([pwa.md](pwa.md)), so over a LAN address the phone gets the small bundle but not the offline
  shell. A `*.ts.net` name behind Tailscale's HTTPS does get it.
- **Updates.** The worker has no `skipWaiting`, so a phone that already has it shows a new build
  only after the app is closed and opened again.
- `pnpm preview:phone` replaces `dist/`; run it from the checkout you want the phone to see.
