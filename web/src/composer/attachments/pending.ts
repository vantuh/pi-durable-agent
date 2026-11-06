import { uploadUrl } from "@/lib/api.ts";
import { randomId } from "@/lib/id.ts";
import type { Pending } from "@/ui/attachments.tsx";

import type { ClientAttachment } from "../../../../shared/protocol.ts";

export function forget(gone: Pending[]): void {
    for (const file of gone) {
        if (file.preview !== undefined) {
            URL.revokeObjectURL(file.preview);
        }
    }
}

/** A file that waits in the queue, back as a composer attachment: the bytes are still under its path. */
export function pendingOf(file: ClientAttachment): Pending {
    return {
        key: randomId(),
        name: file.name,
        size: file.size,
        image: file.image,
        state: "done",
        path: file.path,
        ...(file.image ? { preview: uploadUrl(file.path) } : {}),
    };
}
