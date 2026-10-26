import { Paperclip, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
    Attachment,
    AttachmentAction,
    AttachmentActions,
    AttachmentContent,
    AttachmentDescription,
    AttachmentMedia,
    AttachmentTitle,
    AttachmentTrigger,
} from "@/components/ui/attachment";
import { Spinner } from "@/components/ui/spinner";

/** A file in the composer: on screen at once, `path` once the server has it. */
export type Pending = {
    key: string;
    name: string;
    size: number;
    image: boolean;
    state: "uploading" | "done" | "error";
    /** An object URL of the local file, so a picture shows before it is uploaded. */
    preview?: string;
    path?: string;
};

type Props = {
    files: Pending[];
    onRemove: (key: string) => void;
};

function size(bytes: number): string {
    return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function srcOf(file: Pending): string | undefined {
    if (file.preview !== undefined) {
        return file.preview;
    }

    return file.path === undefined
        ? undefined
        : `/api/uploads?path=${encodeURIComponent(file.path)}`;
}

function Lightbox({ file, onClose }: { file: Pending; onClose: () => void }) {
    useEffect(() => {
        const close = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", close);

        return () => {
            window.removeEventListener("keydown", close);
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <button
                type="button"
                aria-label="Close preview"
                onClick={onClose}
                className="bg-sunken/90 absolute inset-0 cursor-zoom-out"
            />
            <div className="relative flex max-h-full max-w-full flex-col items-center gap-2">
                <img
                    src={srcOf(file)}
                    alt={file.name}
                    className="rounded-card max-h-[calc(100dvh-6rem)] max-w-full object-contain"
                />
                <p className="text-meta text-muted max-w-full truncate font-mono">{file.name}</p>
            </div>
        </div>
    );
}

export function Attachments({ files, onRemove }: Props) {
    const [open, setOpen] = useState<Pending | undefined>(undefined);

    if (files.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 pb-2">
            {files.map((file) => (
                <Attachment key={file.key} state={file.state}>
                    {file.image && file.state === "done" ? (
                        <AttachmentTrigger
                            title="Preview"
                            onClick={() => {
                                setOpen(file);
                            }}
                        />
                    ) : null}

                    <AttachmentMedia>
                        {file.image && srcOf(file) !== undefined ? (
                            <img src={srcOf(file)} alt="" />
                        ) : file.state === "error" ? (
                            <TriangleAlert className="size-3.5" />
                        ) : (
                            <Paperclip className="size-3.5" />
                        )}
                        {file.state === "uploading" ? (
                            <Spinner className="text-ink absolute size-4" />
                        ) : null}
                    </AttachmentMedia>

                    <AttachmentContent>
                        <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                        <AttachmentDescription>
                            {file.state === "uploading"
                                ? "Uploading…"
                                : file.state === "error"
                                  ? "Upload failed"
                                  : size(file.size)}
                        </AttachmentDescription>
                    </AttachmentContent>

                    <AttachmentActions>
                        <AttachmentAction
                            title="Remove"
                            onClick={() => {
                                onRemove(file.key);
                            }}
                        >
                            <X className="size-3" />
                        </AttachmentAction>
                    </AttachmentActions>
                </Attachment>
            ))}

            {open === undefined ? null : (
                <Lightbox
                    file={open}
                    onClose={() => {
                        setOpen(undefined);
                    }}
                />
            )}
        </div>
    );
}
