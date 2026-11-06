import { entryImageUrl } from "@/lib/api.ts";
import { imagesOf } from "@/lib/step-summary.ts";
import type { Step } from "@/lib/turns.ts";
import { ImageThumbs } from "@/ui/attachments.tsx";

import { useSession } from "../session.ts";

/** Pictures the group's calls returned, below its lines: seen without opening a call. */
export function GroupImages({ steps }: { steps: Step[] }) {
    const session = useSession();
    const images = imagesOf(steps);

    if (session === null || images.length === 0) {
        return null;
    }

    return (
        <ImageThumbs
            images={images.map((image) => ({
                src: entryImageUrl(session, image.entry, image.index),
                name: image.name,
            }))}
        />
    );
}
