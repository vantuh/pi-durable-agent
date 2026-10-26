import { Paperclip, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                aria-describedby={undefined}
                className="bg-panel border-edge rounded-card inset-auto top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-auto max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-1.5 border p-1.5 sm:max-h-[calc(100dvh-2rem)] sm:w-auto sm:max-w-[calc(100vw-2rem)]"
            >
                <DialogTitle className="sr-only">{file.name}</DialogTitle>
                <img
                    src={srcOf(file)}
                    alt={file.name}
                    className="rounded-control max-h-[calc(100dvh-8rem)] max-w-full object-contain"
                />
                <p className="text-meta text-muted max-w-full truncate px-1 font-mono">
                    {file.name}
                </p>
            </DialogContent>
        </Dialog>
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
