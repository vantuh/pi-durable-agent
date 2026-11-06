/**
 * Where dictated words go in the message box: at the caret, with a space only where words would
 * touch, and a capital on a sentence's first word. The joining rules are Pi Pocket's `web/voice.js`
 * and `dictate.ts`; nothing here is live, because the words arrive once, after the recording.
 */

/** The part of the box the words go into. */
export type Field = {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
};

/** The box's new text, and where the caret goes in it. */
export type Insertion = { readonly value: string; readonly at: number };

/** Words said into a box, replacing whatever the person has selected. */
export function insert(field: Field, words: string): Insertion {
    const before = field.value.slice(0, field.selectionStart);
    const after = field.value.slice(field.selectionEnd);
    const start = /\S$/.test(before) ? " " : "";
    const end = /^[^\s.,;:!?)]/.test(after) ? " " : "";
    // A sentence's first word starts with a capital, as whisper leaves some in lower case.
    const capital = before.trim() === "" || /[.!?]\s*$/.test(before);
    const said = capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
    const head = before + start + said;

    return { value: head + end + after, at: head.length };
}
