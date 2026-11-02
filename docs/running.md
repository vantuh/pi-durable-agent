# Running it

## On the computer

`pnpm dev` runs the server on `127.0.0.1:8788` and Vite with HMR. `pnpm start` builds the shell and
serves it from the server alone.

## On the phone

Through Tailscale: `tailscale serve --bg 8443 http://127.0.0.1:8788` puts the server's own
production build on `https://<machine>.<tailnet>.ts.net:8443/`, tailnet only. That address is HTTPS,
so the service worker registers and the offline shell works; nothing listens on the local network.
The shell it serves is `dist/`, so run `pnpm start` (or `pnpm build`) after a change, or press the
hammer in Settings, which rebuilds from the app through `POST /api/build` and needs no restart. A
new build reaches a phone that already has the worker only after the app is closed and opened again.

Without such a proxy, the dev build is the wrong thing to load on a phone: about 170 requests and
15 MB of JavaScript to parse, an HMR socket, and React's dev-mode double renders. The production
build is about 50 requests and 1.6 MB to parse (measured on a mobile viewport, cold load).

```bash
pnpm preview:phone
```

It builds, then serves `dist/` with `vite preview --host --port 5192 --strictPort`. Open the
`Network:` address it prints, for example `http://192.168.31.210:5192/`. Vite's preview server uses
`server.proxy`, so `/api` (the event streams too) reaches the server on `127.0.0.1:8788`, which
keeps its address: only the preview listens on the network. The server must already be running.

### HTTPS on the LAN

A LAN address is a secure context only over HTTPS, and a phone on plain HTTP has no
`crypto.randomUUID`, no service worker and no microphone. `vite.config.ts` serves the preview over
HTTPS when two files exist and over HTTP when they do not, so this is optional:

```bash
brew install mkcert && mkcert -install
mkcert -cert-file .certs/lan.pem -key-file .certs/lan-key.pem 192.168.31.210 <host>.local localhost
```

The IP must be in the certificate, and `.certs/` is untracked. The phone has to trust mkcert's CA
otherwise it replaces the warning with a worse one: send it `$(mkcert -CAROOT)/rootCA.pem`, install
the profile, and on iOS also enable full trust in Settings → General → About → Certificate Trust
Settings.

- **No authentication.** Anyone on the same network can open the app and run tools on this machine.
  It is the same exposure as `vite --host` in development. Use a network you trust.
- **No service worker over plain HTTP.** A browser registers one only on HTTPS or `localhost`
  ([pwa.md](pwa.md)), so over a plain LAN address the phone gets the small bundle but not the offline
  shell. A `*.ts.net` name behind Tailscale's HTTPS does get it, and so does the LAN preview once the
  certificate above is in place.
- **Updates.** The worker has no `skipWaiting`, so a phone that already has it shows a new build
  only after the app is closed and opened again.
- `pnpm preview:phone` replaces `dist/`; run it from the checkout you want the phone to see.
