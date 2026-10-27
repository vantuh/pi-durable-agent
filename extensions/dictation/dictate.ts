/**
 * Dictation into a textarea with the browser's own speech recognition (the Web Speech API).
 * Words show in the box as they are heard and stay once the browser settles on them; nothing is
 * ever sent by itself. Chrome sends the audio to Google's servers to be recognised; Safari has it
 * too; Firefox has none.
 *
 * Ported from Pi Pocket's `web/voice.js` (MIT), rewritten without its UI framework and without
 * its shortcut and many-boxes bookkeeping.
 */

/** The part of a textarea dictation uses. */
export type Field = {
    value: string;
    selectionStart: number;
    selectionEnd: number;
    setSelectionRange: (start: number, end: number) => void;
};

type Heard = { readonly isFinal: boolean; readonly [0]: { readonly transcript: string } };

type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: { results: ArrayLike<Heard> }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type Recognizer = new () => Recognition;

function isRecognizer(value: unknown): value is Recognizer {
    return typeof value === "function";
}

function recognizer(): Recognizer | undefined {
    const found: unknown =
        Reflect.get(globalThis, "SpeechRecognition") ??
        Reflect.get(globalThis, "webkitSpeechRecognition");

    return isRecognizer(found) ? found : undefined;
}

/** Whether the mic can work here: a recognizer, and a page browsers give the microphone to. */
export function dictationAvailable(): boolean {
    return globalThis.isSecureContext && recognizer() !== undefined;
}

/** What each of the recognizer's errors means for the person; those not here are named as they are. */
const ERRORS: Record<string, string> = {
    "not-allowed": "The microphone is blocked. Allow it for this site in the browser's settings.",
    "service-not-allowed": "This browser does not allow dictation here.",
    "no-speech": "No speech heard. Tap the mic and try again.",
    "audio-capture": "No microphone found.",
    network: "Dictation needs the network: the browser recognises speech on its own servers.",
    "language-not-supported": "This browser cannot recognise your language.",
};

/**
 * How long the starts of `a` and `b` agree, and their ends, each on its own: an edit that repeats
 * what is beside it ("H" typed before "Hello") fits both ways, and either way it is outside what agrees.
 */
function common(a: string, b: string): { head: number; tail: number } {
    let head = 0;

    while (head < a.length && head < b.length && a[head] === b[head]) {
        head++;
    }

    let tail = 0;

    while (
        tail < a.length &&
        tail < b.length &&
        a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) {
        tail++;
    }

    return { head, tail };
}

/** Words heard, put between what the box has before and after them, with a space where words would touch. */
function join(before: string, words: string, after: string): { value: string; at: number } {
    if (words === "") {
        return { value: before + after, at: before.length };
    }

    const start = /\S$/.test(before) ? " " : "";
    const end = /^[^\s.,;:!?)]/.test(after) ? " " : "";
    // A sentence's first word starts with a capital, as the browser leaves some in lower case.
    const capital = before.trim() === "" || /[.!?]\s*$/.test(before);
    const said = capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    const head = before + start + said;

    return { value: head + end + after, at: head.length };
}

export type DictationOptions = {
    /** The box to write into, or null when it is gone. */
    field: () => Field | null;
    /** Whether the box has the focus: words go in at the caret then, after its text otherwise. */
    focused: () => boolean;
    /** Hears each change to the box, as typing does, so the box's own draft saving keeps it. */
    onText: (value: string) => void;
    onListening: (listening: boolean) => void;
    onNotice: (level: "info" | "error", text: string) => void;
};

export type Dictation = {
    toggle: () => void;
    /** `drop` throws away words not yet settled: for sending and leaving. */
    stop: (drop?: boolean) => void;
};

export function createDictation(options: DictationOptions): Dictation {
    let active: Recognition | null = null;

    const stop = (drop = false): void => {
        const recognition = active;

        if (recognition === null) {
            return;
        }

        active = null;
        options.onListening(false);

        if (drop) {
            recognition.onresult = null;
            recognition.abort();
        } else {
            recognition.stop();
        }
    };

    const start = (): void => {
        const element = options.field();
        const Recognition = recognizer();

        if (element === null || Recognition === undefined) {
            return;
        }

        const recognition = new Recognition();

        recognition.lang = navigator.language || "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;
        active = recognition;

        // What the box had around the words, the results already in it, and the box as dictation left
        // it: its text and its selection. `pending` is the first result not settled yet, and `span`
        // where its words are.
        let base = { before: "", after: "" };
        let from = 0;
        let seen = 0;
        let pending = 0;
        let span = [0, 0];
        // The person moved on while words were still coming: those finish where they are, then words
        // go where the person is.
        let moving = false;

        const selected = (): [number, number] => [element.selectionStart, element.selectionEnd];

        const rebase = (): void => {
            const at = options.focused() ? element.selectionStart : element.value.length;
            const end = options.focused() ? element.selectionEnd : at;

            base = { before: element.value.slice(0, at), after: element.value.slice(end) };
            from = seen;
            moving = false;
        };

        rebase();

        let written = element.value;
        let selection = selected();

        // Typed into, or the caret moved, since the words last went in. Outside the words still
        // coming, those finish where they are, around what the person did; on them, the person's
        // edit wins, and what is heard next goes where the caret is.
        const changed = (): void => {
            const value = element.value;
            const [s = 0, e = 0] = span;
            const { head, tail } = common(written, value);
            // Where the edit was in what dictation wrote: after the words coming (they are in the
            // start that agrees), or before them (in the end that agrees).
            const after = value === written || head >= e;
            const before = !after && written.length - tail <= s;

            if (pending >= seen || !(after || before)) {
                rebase();

                return;
            }

            const shift = before ? value.length - written.length : 0;

            base = { before: value.slice(0, s + shift), after: value.slice(e + shift) };
            from = pending;
            moving = true;
        };

        recognition.onresult = (event) => {
            const results = event.results;

            if (
                element.value !== written ||
                (options.focused() && selected().some((at, index) => at !== selection[index]))
            ) {
                changed();
            }

            // What is settled, then what may still change, from the first result not settled on.
            let first = from;

            while (first < results.length && results[first]?.isFinal === true) {
                first++;
            }

            const said = (lo: number, hi: number): string => {
                const words: string[] = [];

                for (let index = lo; index < hi; index++) {
                    words.push(results[index]?.[0].transcript.trim() ?? "");
                }

                return words.filter(Boolean).join(" ");
            };

            const settled = said(from, first);
            const coming = said(first, results.length);
            const all = [settled, coming].filter(Boolean).join(" ");
            const { value, at } = join(base.before, all, base.after);
            // Where the words still coming start: after the settled ones and a space, or where all start.
            const startOfComing =
                settled === ""
                    ? base.before.length + (all !== "" && /\S$/.test(base.before) ? 1 : 0)
                    : join(base.before, settled, base.after).at + (coming === "" ? 0 : 1);
            // Where the text after the words ends up: the person's selection there moves with it.
            const was = element.value.length - base.after.length;
            const now = value.length - base.after.length;
            const person = selected();

            seen = results.length;
            pending = first;
            span = [startOfComing, at];
            written = value;
            element.value = value;

            if (options.focused()) {
                const place = (point: number): number =>
                    point >= was ? point + now - was : Math.min(point, now);

                if (moving) {
                    element.setSelectionRange(place(person[0]), place(person[1]));
                } else {
                    element.setSelectionRange(at, at);
                }
            }

            selection = selected();
            options.onText(value);

            // The words left behind are all settled: what comes next goes where the person is.
            if (moving && first === results.length) {
                rebase();
            }
        };

        recognition.onerror = (event) => {
            // Aborted is this app's own doing; no speech for a while ends a quiet dictation, said once.
            if (event.error !== "aborted") {
                options.onNotice(
                    event.error === "no-speech" ? "info" : "error",
                    ERRORS[event.error] ?? `Dictation stopped: ${event.error}.`,
                );
            }
        };

        recognition.onend = () => {
            if (active === recognition) {
                stop();
            }
        };

        try {
            recognition.start();
            options.onListening(true);
        } catch (error) {
            active = null;
            options.onNotice(
                "error",
                `Dictation did not start: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    };

    return {
        stop,
        toggle: () => {
            if (active === null) {
                start();
            } else {
                stop();
            }
        },
    };
}
