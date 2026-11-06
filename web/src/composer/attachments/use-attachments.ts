import { useState } from "react";

import { uploadFile } from "@/lib/api.ts";
import { randomId } from "@/lib/id.ts";
import type { Pending } from "@/ui/attachments.tsx";

import { composerFiles, setComposerFiles } from "./files.ts";
import { useDropBatch } from "./use-drop-batch.ts";
import { useWindowDrop } from "./use-window-drop.ts";

export function useAttachments(sessionId: string) {
    const [files, setLocalFiles] = useState<Pending[]>(() => composerFiles(sessionId));
    // Written through the store too, so an upload that ends after the session was left still lands.
    const setFiles = (update: (current: Pending[]) => Pending[]): void => {
        const next = update(composerFiles(sessionId));
        setComposerFiles(sessionId, next);
        setLocalFiles(next);
    };
    const uploading = files.some((file) => file.state === "uploading");
    const [batch, setBatch] = useDropBatch(files);

    // Each file shows at once as uploading and settles on its own: done with a path, or failed.
    const addFiles = (chosen: File[]): string[] => {
        const fresh = chosen.map((file): [File, Pending] => {
            const image = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);

            return [
                file,
                {
                    key: randomId(),
                    name: file.name,
                    size: file.size,
                    image,
                    state: "uploading",
                    ...(image ? { preview: URL.createObjectURL(file) } : {}),
                },
            ];
        });

        setFiles((current) => [...current, ...fresh.map(([, pending]) => pending)]);

        for (const [file, pending] of fresh) {
            void (async () => {
                const saved = await uploadFile(file);

                setFiles((current) =>
                    current.map((each) =>
                        each.key === pending.key
                            ? saved === undefined
                                ? { ...each, state: "error" }
                                : { ...each, state: "done", path: saved.path, size: saved.size }
                            : each,
                    ),
                );
            })();
        }

        return fresh.map(([, pending]) => pending.key);
    };

    const dragging = useWindowDrop((dropped) => {
        setBatch(addFiles(dropped));
    });

    return { files, setFiles, addFiles, uploading, batch, dragging };
}
