# Image limit

`extensions/image-limit` shrinks an image that a provider would refuse, before each request leaves:
its `GenerationTask.beforeRequest` hook walks the whole model context, so an attachment, an image a
tool returned and an image already committed all pass through it. The case it answers is Anthropic's
"At least one of the image dimensions exceed max allowed size for many-image requests: 3000 pixels":
an image that breaks a request stays in the history it came from, so every later turn fails too,
until the session is abandoned.

- **2000 px on the longest side**, the cap both providers use when a request carries more than one
  image. Resizing is `resizeImage` from `@earendil-works/pi-coding-agent` — Photon in a worker, the
  same code an image read by `files` already goes through — so no new dependency.
- **Only an image over the limit is touched.** Everything else goes byte-identical, which is what
  keeps the provider's prompt cache holding across turns; the decision is made on the dimensions the
  decoder reports, not on encoded size. The library encodes PNG first and falls back to JPEG only
  when a photo will not fit under its 4.5 MB cap, so an image with transparency stays PNG, and a
  result also stays under the provider's 5 MB per-image limit. An image under 2000 px that is over
  that 5 MB is left alone: a different limit, and not the one this answers.
- **One decode per image.** Sized images are remembered by MIME type, payload length and a hash of
  the payload — 128 of them, oldest evicted, cleared in `host.onDispose` — and a second request that
  carries an image while it is being resized waits on the same work instead of starting a second
  decode. The same image always leaves as the same bytes.
- **It fails open.** An image the decoder cannot read, or one the encoder cannot get under the limit,
  goes as it is: a shrinking pass never drops a part and never fails the request.
- **The transcript is not rewritten.** The hook returns replacement messages for that request only,
  so the conversation keeps the pixels the person sent, and compaction reads them as text anyway.
- **Nothing to configure and no restart.** It is a hook like any other, installed and removed live;
  turn it off in the Extensions dialog to send images exactly as they are.
