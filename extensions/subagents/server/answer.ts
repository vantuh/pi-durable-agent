import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

function assistantOf(entry: EntryRecord | undefined): AssistantMessage | undefined {
    const message = entry?.model?.[0];

    return message?.role === "assistant" ? message : undefined;
}

export function answerText(entry: EntryRecord | undefined): string {
    return (
        assistantOf(entry)
            ?.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("")
            .trim() ?? ""
    );
}

/**
 * What the provider reported answering: its own engine when it named one, else the model it was asked for.
 * The profile's model is no proof of either, and it is never asked again.
 */
export function answerModel(entry: EntryRecord | undefined): string | undefined {
    const message = assistantOf(entry);

    if (message === undefined) {
        return undefined;
    }

    const served = message.responseModel;

    return `${message.provider}/${served === undefined || served === "" ? message.model : served}`;
}
