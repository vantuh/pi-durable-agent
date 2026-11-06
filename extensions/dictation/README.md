# Dictation

`extensions/dictation` adds a mic to the composer, ported from Pi Pocket's `local-dictation`.
It uses the shared [composer slot](../../docs/extensions.md#composer-items). The browser records
with `MediaRecorder`, resamples what it heard to 16 kHz mono 16-bit PCM and posts it
to this server's own routes, which transcribe it here with `transcribe-cpp` — a Handy whisper or
parakeet GGUF on Metal. No audio goes to an external speech service. A remote browser still needs
a connection to this server. The mic remains visible in an unsupported browser or insecure
context; pressing it shows an error instead of recording. Microphone access needs a secure context
(HTTPS or localhost), `MediaRecorder` and the browser's media-devices API.

- Three settings live in `dictation.json` in the data directory, and `details.tsx` — the Dictation
  row in the Extensions dialog, expanded — is the only way to change them: `language` (Auto, English
  or Ukrainian — `uk` stands in while the file does not exist yet, and `auto` passes no hint at all
  so the model detects it), `model` (null for the first Handy GGUF found, else an absolute
  `.gguf` path) and `idleMinutes` (0 to 1440, default 10). No environment variables, and no settings
  section in the shell's panel. A file written before the model and the idle time were settings
  still reads, taking the defaults for the two it lacks.
- The model dropdown lists the whisper and parakeet GGUFs under `~/.cache/huggingface/hub` with
  their names and sizes, the `large-v3-turbo` `Q8_0` first, and says so when there is none. A
  parakeet ignores the language hint and detects it instead. The model holds ~900 MB
  with Metal, so it loads when a recording starts and goes after `idleMinutes` without a dictation;
  `0` lets it go as soon as the dictation that needed it ends. A failed load is tried again at the
  next one, and a chosen model whose file is gone says which path it wanted.
- The audio arrives in numbered parts of 300 000 bytes, joined back in number order and refused
  past 32 MiB; unfinished uploads older than ten minutes are discarded when another part arrives,
  and anything under 0.35 s is a tap rather than a word.
- A short rising tone marks the start of a recording and a falling one its end (`web/beep.ts`, Web
  Audio; no files). The tone follows listening, not the text: transcription finishes later and says
  nothing.
- It never sends. Tap the mic again to stop, and the words go into the box at the caret, with a
  space only where words would touch and a capital on a sentence's first word (`web/insert.ts`, no
  React; its tests are plain strings). Unmounting the mic, including leaving the app or turning the
  extension off, drops a recording in flight. Switching sessions while the mic stays mounted sends
  the finished text to the current composer, not necessarily the session where recording began.
- `server.ts` holds the model, the routes (`warm`, `audio`, `transcribe` under
  `/api/extensions/dictation/http/`) and the two actions behind the settings, `settings` and
  `saveSettings`, which validate every field with the rules the file is read with. `details.tsx`
  asks for them only while the folder is installed and on; off, it says so instead.
