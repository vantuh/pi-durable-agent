import { File, Lightbulb } from "lucide-react";
import { memo, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { splitQuote } from "@/lib/quote.ts";
import type { Turn } from "@/lib/turns.ts";
import { Attachments } from "@/ui/attachments.tsx";
import { QuoteCard } from "@/ui/quote.tsx";

/** `@path` after whitespace, anywhere in the text; the punctuation that ends a sentence is not part of the path. */
const MENTION = /(^|\s)@([^\s@]*[^\s@.,;:!?)\]])/g;

/** The text with each `@path` drawn as a file badge. */
function WithFiles({ text }: { text: string }) {
    const parts: ReactNode[] = [];
    let at = 0;

    for (const match of text.matchAll(MENTION)) {
        const start = match.index + (match[1]?.length ?? 0);

        parts.push(text.slice(at, start));
        parts.push(
            <Badge key={start} tone="info" className="align-middle">
                <File />
                {match[2]}
            </Badge>,
        );
        at = start + 1 + (match[2]?.length ?? 0);
    }

    parts.push(text.slice(at));

    return <p className="whitespace-pre-wrap">{parts}</p>;
}

/** A message that starts with `/skill:name` shows the skill as a badge, then the request. */
function MessageBody({ text }: { text: string }) {
    const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    const request = match?.[2];

    if (match === null) {
        return text === "" ? null : <WithFiles text={text} />;
    }

    return (
        <div className="flex flex-col items-start gap-1.5">
            <Badge tone="warn">
                <Lightbulb />
                {match[1]}
            </Badge>
            {request === undefined || request === "" ? null : <WithFiles text={request} />}
        </div>
    );
}

/** What the person sent: the words they quoted from an answer, then their own. */
function UserText({ text }: { text: string }) {
    const quoted = splitQuote(text);

    if (quoted === undefined) {
        return <MessageBody text={text} />;
    }

    return (
        <>
            {quoted.quotes.map((quote) => (
                <QuoteCard key={quote} text={quote} />
            ))}
            {quoted.rest === "" ? null : <MessageBody text={quoted.rest} />}
        </>
    );
}

/**
 * The person's own message. A frame of a reply rebuilds the whole turn it lands in; this holds an entry that does not
 * change with it, so it sits behind its own memo and skips the frame.
 */
export const UserMessage = memo(function UserMessage({
    user,
}: {
    user: NonNullable<Turn["user"]>;
}) {
    return (
        <div className="bg-panel text-interface text-ink relative flex min-w-0 flex-col gap-1.5 py-2 pr-3 pl-4">
            <span aria-hidden className="bg-accent w-stripe absolute inset-y-0 left-0" />
            <Attachments
                files={(user.files ?? []).map((file, index) => ({
                    ...file,
                    key: String(index),
                    state: "done",
                }))}
            />
            <UserText text={user.text} />
        </div>
    );
});
