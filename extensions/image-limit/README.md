# Image limit

Shrinks an image that a provider would refuse, before each request leaves. It answers Anthropic's
"At least one of the image dimensions exceed max allowed size for many-image requests: 3000
pixels": an image that breaks a request stays in the history, so every later turn fails too.

## Usage

Nothing to operate. It is a `GenerationTask.beforeRequest` hook, installed and removed live; turn it
off in the Extensions dialog to send images exactly as they are.

## Behavior

- **What it walks.** The whole model context, so an attachment, an image a tool returned and an
  image already committed all pass through it. It applies to every provider.
- **Limits.** 2000 px on the longest side and under 4.5 MiB of base64: the defaults of `resizeImage`
  from `@earendil-works/pi-coding-agent` (Photon in a worker; the same code an image read by
  `files` goes through).
- **Untouched images.** An image within both limits goes byte-identical, so its cache prefix is
  kept. An image under 2000 px is still re-encoded when its base64 is too large.
- **Re-encoding.** The library tries PNG and JPEG (the smaller first), then lower JPEG quality, then
  25% smaller dimensions. A JPEG result loses transparency.
- **One decode per image.** Results are remembered by MIME type, payload length and a hash of the
  payload (128 of them, oldest evicted, cleared on dispose). A second request carrying an image that
  is being resized waits on the same work. The same image always leaves as the same bytes.
- **It fails open.** An image the decoder cannot read, or one the encoder cannot get under the limit,
  goes as it is. The pass never drops a part and never fails the request.
- **The transcript is not rewritten.** The hook returns replacement messages for that request only.
