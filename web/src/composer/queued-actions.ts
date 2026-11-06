import { withdrawQueued } from "@/lib/api.ts";
import { splitQuote } from "@/lib/quote.ts";
import { toast } from "@/lib/toast.ts";
import { addComposerQuote, composerDraft, setComposerDraft } from "@/sdk/composer.ts";
import type { Pending } from "@/ui/attachments.tsx";

import type { ClientQueued, SendMode } from "../../../shared/protocol.ts";
import { pendingOf } from "./attachments/pending.ts";

// ✕ takes it out of `pi.inbox`; the agent never reads it. Answers whether it really went.
export async function takeQueued(sessionId: string, item: ClientQueued): Promise<boolean> {
    const result = await withdrawQueued(Number(sessionId), item.id);

    if (result === "aborted") {
        return true;
    }

    toast.error(
        result === undefined
            ? "Could not take that message back"
            : "The agent is already reading that message",
    );

    return false;
}

// ✎ takes it out of the queue and puts it back in the composer, with its mode and files, to be changed
// and sent again. A draft already there stays, and the message goes below it as one more paragraph.
export async function editQueued(
    sessionId: string,
    item: ClientQueued,
    back: {
        setMode: (mode: SendMode) => void;
        setFiles: (update: (current: Pending[]) => Pending[]) => void;
        focus: () => void;
    },
): Promise<void> {
    if (!(await takeQueued(sessionId, item))) {
        return;
    }

    const draft = composerDraft(sessionId).trim();
    // A quote comes back as a quote, not as the `>` lines it was sent as.
    const written = splitQuote(item.text);

    for (const quote of written?.quotes ?? []) {
        addComposerQuote(sessionId, quote);
    }

    const rest = written?.rest ?? item.text;
    const next = draft === "" ? rest : `${draft}\n\n${rest}`;

    if (draft !== "") {
        toast.info("Added below what you were writing");
    }

    setComposerDraft(sessionId, next);
    back.setMode(item.mode);
    back.setFiles((current) => [...current, ...(item.files ?? []).map(pendingOf)]);
    back.focus();
}
