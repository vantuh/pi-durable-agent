/**
 * Shrinks the images in the model context before each request, so a screenshot wider than the
 * provider's many-image limit does not fail every turn that still carries it: Anthropic answers
 * "At least one of the image dimensions exceed max allowed size for many-image requests: 3000
 * pixels" and leaves the image in the history, where it breaks each later request too.
 *
 * The hook sees the whole context, so an attachment, an image a tool returned and an image already
 * committed all pass through it. The result is used for that request only; nothing is rewritten in
 * the transcript, and compaction still summarizes what the user sent as text.
 */
import { createHash } from "node:crypto";

import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Image limit",
    description: "Shrinks images the provider would refuse to accept, before each request.",
};

/** The longest side both providers accept when a request carries several images. */
const MAX_SIDE = 2000;
/**
 * How many images stay remembered. The hook runs on every request and each conversation sends its
 * own images, so this covers what is open for a while without pinning a session's whole history.
 */
const REMEMBERED = 128;

type Part = TextContent | ImageContent;

/**
 * The image to send in place of the original, or `null` for one that goes as it is. The value is the
 * work itself, so two requests that carry the same image decode it once; it is never a rejection,
 * because an image that cannot be shrunk must not cost the request.
 */
const remembered = new Map<string, Promise<ImageContent | null>>();

/** Keyed by a hash rather than the payload: the payload of one screenshot is megabytes. */
function keyOf(image: ImageContent): string {
    const hash = createHash("sha256").update(image.data).digest("hex");

    return `${image.mimeType}:${String(image.data.length)}:${hash}`;
}

/**
 * Resize one image, or `null` when it goes as it is: within the limit, unreadable, or the encoder
 * found nothing that fits. PNG comes back before JPEG, so an image with transparency stays PNG
 * whenever it fits under the encoder's 4.5 MB cap, which is also what keeps a result under the
 * provider's 5 MB per-image limit.
 */
async function shrink(image: ImageContent): Promise<ImageContent | null> {
    try {
        const result = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType, {
            maxWidth: MAX_SIDE,
            maxHeight: MAX_SIDE,
        });

        if (result === null || Math.max(result.originalWidth, result.originalHeight) <= MAX_SIDE) {
            return null;
        }

        return { type: "image", data: result.data, mimeType: result.mimeType };
    } catch {
        return null;
    }
}

/** The image as the provider should see it, or undefined when it goes as it is. */
async function smaller(image: ImageContent): Promise<ImageContent | undefined> {
    const key = keyOf(image);
    let resized = remembered.get(key);

    if (resized === undefined) {
        if (remembered.size >= REMEMBERED) {
            const oldest = remembered.keys().next();

            if (!oldest.done) {
                remembered.delete(oldest.value);
            }
        }

        resized = shrink(image);
        remembered.set(key, resized);
    }

    return (await resized) ?? undefined;
}

/** The content with every oversized image replaced, or undefined when it holds none. */
async function shrunk(content: readonly Part[]): Promise<Part[] | undefined> {
    let replaced: Part[] | undefined;

    for (const [index, part] of content.entries()) {
        if (part.type !== "image") {
            continue;
        }

        const smallerPart = await smaller(part);

        if (smallerPart === undefined) {
            continue;
        }

        replaced ??= [...content];
        replaced[index] = smallerPart;
    }

    return replaced;
}

/** Runs before each request attempt, including a retry, which is also what recovers a failed turn. */
export async function beforeRequest(request: {
    readonly messages: readonly Message[];
}): Promise<{ readonly messages: readonly Message[] } | undefined> {
    let changed = false;
    const messages: Message[] = [];

    for (const message of request.messages) {
        if (message.role === "user" && typeof message.content !== "string") {
            const content = await shrunk(message.content);

            changed ||= content !== undefined;
            messages.push(content === undefined ? message : { ...message, content });
            continue;
        }

        if (message.role === "toolResult") {
            const content = await shrunk(message.content);

            changed ||= content !== undefined;
            messages.push(content === undefined ? message : { ...message, content });
            continue;
        }

        messages.push(message);
    }

    return changed ? { messages } : undefined;
}

export default function imageLimit(host: Host) {
    // A replaced or removed version must not hold the images of a conversation nobody can reach.
    host.onDispose(() => {
        remembered.clear();
    });

    return defineExtension({
        name: host.name,
        hooks: [hook(GenerationTask, { beforeRequest })],
    });
}
