/**
 * The browser's half of local dictation: record the microphone, resample to what whisper takes, and
 * hand the audio to this server's own routes, which transcribe it here. Ported from Pi Pocket's
 * `local-dictation/index.js` (MIT).
 */

/** Where `server.ts` mounts its routes. */
const ROUTE = "/api/extensions/dictation/http";

/** What the model takes: 16 kHz mono 16-bit PCM. */
const RATE = 16_000;

/** Bytes of PCM in one request: base64 keeps it well under the route's 4 MB body. */
const PART_BYTES = 300_000;

/** Shorter than this is a tap, not a word. */
const MIN_SECONDS = 0.35;

/** A recorder's type, in the order the browsers name them: Chrome and Safari differ. */
const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

export function messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure);
}

/** Whether the mic can work here: a recorder, the microphone API, and a page browsers give it to. */
export function supportsRecording(): boolean {
    return (
        globalThis.isSecureContext &&
        typeof MediaRecorder !== "undefined" &&
        navigator.mediaDevices !== undefined
    );
}

export function recorderType(): string | undefined {
    return TYPES.find((each) => MediaRecorder.isTypeSupported(each));
}

/** The microphone, mono, with the room's echo and hum filtered: both reach the model as words otherwise. */
export async function microphone(): Promise<MediaStream> {
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
    } catch (failure) {
        throw new Error(`No microphone: ${messageOf(failure)}`, { cause: failure });
    }
}

/** Asks the server to load the model now, so it is ready by the time the person stops speaking. */
export async function warm(): Promise<void> {
    await post("warm", {});
}

/** Sends the recording in parts, then has the server transcribe it whole: split audio loses words at the cuts. */
export async function transcribeRecording(chunks: readonly Blob[]): Promise<string> {
    const first = chunks[0];

    if (first === undefined) {
        throw new Error("Nothing was recorded.");
    }

    const pcm = await toPcm(new Blob([...chunks], { type: first.type }));

    if (pcm.length < RATE * MIN_SECONDS) {
        throw new Error("Too short to transcribe.");
    }

    const id = crypto.randomUUID();
    const samples = PART_BYTES / 2;

    for (let seq = 0, at = 0; at < pcm.length; seq++, at += samples) {
        const part = pcm.subarray(at, at + samples);

        await post("audio", {
            id,
            seq,
            pcm: toBase64(new Uint8Array(part.buffer, part.byteOffset, part.byteLength)),
        });
    }

    const payload = await post("transcribe", { id });
    const text: unknown =
        typeof payload === "object" && payload !== null ? Reflect.get(payload, "text") : undefined;

    if (typeof text !== "string") {
        throw new Error("The dictation server answered without text.");
    }

    return text;
}

/** A route of this extension's server half; an answer that is not `ok` throws its `error`. */
async function post(name: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${ROUTE}/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
        const failure: unknown =
            typeof payload === "object" && payload !== null
                ? Reflect.get(payload, "error")
                : undefined;

        throw new Error(
            typeof failure === "string" ? failure : `Dictation: ${String(response.status)}`,
        );
    }

    return payload;
}

/** Bytes as base64, in pieces: one call with a whole recording would exceed the stack. */
function toBase64(bytes: Uint8Array): string {
    let text = "";

    for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }

    return btoa(text);
}

/** What the recorder heard, as 16 kHz mono 16-bit samples. */
async function toPcm(blob: Blob): Promise<Int16Array> {
    const context = new AudioContext();
    let decoded: AudioBuffer;

    try {
        decoded = await context.decodeAudioData(await blob.arrayBuffer());
    } finally {
        await context.close();
    }

    if (decoded.duration < MIN_SECONDS) {
        throw new Error("Too short to transcribe.");
    }

    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
    const source = offline.createBufferSource();

    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();

    const channel = (await offline.startRendering()).getChannelData(0);
    const pcm = new Int16Array(channel.length);

    for (let at = 0; at < channel.length; at++) {
        pcm[at] = Math.max(-1, Math.min(1, channel[at] ?? 0)) * 0x7fff;
    }

    return pcm;
}
