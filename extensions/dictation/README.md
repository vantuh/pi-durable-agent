# Dictation

Adds a mic to the composer. The browser records with `MediaRecorder`, resamples to 16 kHz mono
16-bit PCM and posts it to this server's own routes, which transcribe it with `transcribe-cpp` (a
Handy whisper or parakeet GGUF on Metal). No audio goes to an external speech service. It uses the
shared [composer slot](../../docs/extensions.md#composer-items).

## Usage

- Tap the mic to start recording, tap again to stop. The words go into the box at the caret, with a
  space only where words would touch and a capital on a sentence's first word (`web/insert.ts`). It
  never sends.
- A short rising tone marks the start of a recording and a falling one its end (`web/beep.ts`, Web
  Audio). The tone follows listening, not the text; transcription finishes later and says nothing.
- Unmounting the mic (leaving the app, turning the extension off) drops a recording in flight.
  Switching sessions while the mic stays mounted sends the finished text to the current composer, not
  necessarily the session where recording began.
- Microphone access needs a secure context (HTTPS or localhost), `MediaRecorder` and the browser's
  media-devices API. In an unsupported browser the mic stays visible and shows an error when pressed.
  A remote browser still needs a connection to this server.

## Configuration

Three settings in `dictation.json` in the data directory. The Dictation row in the Extensions dialog
(`details.tsx`) is the only way to change them; there are no environment variables.

- `language`: Auto, English or Ukrainian. The default is `uk`; `auto` passes no hint, so the model
  detects it. A parakeet model ignores the hint and detects it.
- `model`: `null` for the first Handy GGUF found, else an absolute `.gguf` path. The dropdown lists
  the whisper and parakeet GGUFs under `~/.cache/huggingface/hub` with names and sizes, the
  `large-v3-turbo` `Q8_0` first, and says so when there is none.
- `idleMinutes`: 0 to 1440, default 10. The model (about 900 MB with Metal) loads when a recording
  starts and unloads after this many minutes without a dictation; `0` unloads it as soon as the
  dictation that needed it ends.

A file written before `model` and `idleMinutes` existed still reads, taking their defaults.

## Behavior

- `server.ts` holds the model, the routes (`warm`, `audio`, `transcribe` under
  `/api/extensions/dictation/http/`) and the actions `settings` and `saveSettings`, which validate
  every field with the rules the file is read with. `details.tsx` asks for them only while the
  extension is installed and on.
- Audio arrives in numbered parts of 300 000 bytes, joined in number order and refused past 32 MiB.
  Unfinished uploads older than ten minutes are discarded when another part arrives. Anything under
  0.35 s is a tap, not a word.
- A failed model load is tried again at the next dictation. A chosen model whose file is gone says
  which path it wanted.

The design follows Pi Pocket's `local-dictation`.
