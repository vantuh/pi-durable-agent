import type { LogEntry } from "../refs.ts";
import type { Json } from "./cdp.ts";

const MAX_LOGS = 300;

/** A console argument as text: strings as they are, other values as DevTools would show them in one line. */
export function formatArg(arg: Json): string {
    if (arg === undefined || arg === null) {
        return "";
    }

    if (arg.type === "string") {
        return String(arg.value);
    }

    if (arg.type === "undefined") {
        return "undefined";
    }

    if (arg.unserializableValue !== undefined) {
        return String(arg.unserializableValue);
    }

    if (Object.hasOwn(arg, "value")) {
        return JSON.stringify(arg.value);
    }

    const preview = arg.preview;

    if (preview !== undefined && Array.isArray(preview.properties)) {
        const items = preview.properties.map((property: Json) =>
            preview.subtype === "array" ? property.value : `${property.name}: ${property.value}`,
        );
        const body = `${items.join(", ")}${preview.overflow ? ", …" : ""}`;

        return preview.subtype === "array"
            ? `[${body}]`
            : `${arg.className && arg.className !== "Object" ? `${arg.className} ` : ""}{${body}}`;
    }

    return String(arg.description ?? arg.className ?? arg.type);
}

/** A page's console: the lines it printed, numbered, and the errors among them since it last navigated. */
export class PageLog {
    #entries: LogEntry[] = [];
    #seq = 0;
    #errors = 0;

    add(level: string, text: string, source?: string): void {
        const entry: LogEntry = {
            seq: ++this.#seq,
            at: Date.now(),
            level,
            text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text,
            ...(source === undefined || source === "" ? {} : { source }),
        };

        this.#entries.push(entry);

        if (this.#entries.length > MAX_LOGS) {
            this.#entries.splice(0, this.#entries.length - MAX_LOGS);
        }

        if (level === "error") {
            this.#errors++;
        }
    }

    /** Console lines after `after` (all of them by default). */
    since(after = 0): LogEntry[] {
        return this.#entries.filter((entry) => entry.seq > after);
    }

    get seq(): number {
        return this.#seq;
    }

    get errors(): number {
        return this.#errors;
    }

    /** A new document counts errors again. */
    resetErrors(): void {
        this.#errors = 0;
    }

    clear(): void {
        this.#entries = [];
        this.#errors = 0;
        // Counted as a change, so the panel fetches the (empty) console again.
        this.#seq++;
    }
}
