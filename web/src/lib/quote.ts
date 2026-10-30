/** The text as a blockquote, line by line: what the model reads when a message starts with a quote. */
export function quoteBlock(text: string): string {
    return text
        .trim()
        .split("\n")
        .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
        .join("\n");
}

/** Quotes, then what the person wrote after them, as the one message that is sent. */
export function withQuotes(quotes: readonly string[], text: string): string {
    const body = text.trim();

    if (quotes.length === 0) {
        return body;
    }

    // A blank line between them, so each quote is its own blockquote — the way the composer showed them.
    const quoted = quotes.map(quoteBlock).join("\n\n");

    return body === "" ? quoted : `${quoted}\n\n${body}`;
}

/** A message that starts with blockquotes: the words taken from answers, and the person's own after them. */
export function splitQuote(text: string): { quotes: string[]; rest: string } | undefined {
    const lines = text.split("\n");
    const quotes: string[] = [];
    let quoted: string[] = [];
    let at = 0;

    for (; at < lines.length; at += 1) {
        const line = lines[at] ?? "";

        if (line.startsWith(">")) {
            quoted.push(line.replace(/^> ?/, ""));
            continue;
        }

        // A blank line between two blockquotes, or after the last one.
        if (line.trim() !== "" || quoted.length === 0) {
            break;
        }

        quotes.push(quoted.join("\n").trim());
        quoted = [];
    }

    if (quoted.length > 0) {
        quotes.push(quoted.join("\n").trim());
    }

    const kept = quotes.filter((quote) => quote !== "");

    if (kept.length === 0) {
        return undefined;
    }

    return { quotes: kept, rest: lines.slice(at).join("\n").trim() };
}
