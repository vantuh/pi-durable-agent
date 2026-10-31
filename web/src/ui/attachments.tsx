import { Paperclip, TriangleAlert, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";

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
    onRemove?: (key: string) => void;
};

// The zoom library is only for the viewer; fetched when a picture opens, not at boot.
const Lightbox = lazy(async () => ({ default: (await import("./lightbox.tsx")).Lightbox }));

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

/** A file as a card, its picture a chip: a message's attachments, and the composer's row. */
function Chip({
    file,
    src,
    preview,
    onRemove,
}: {
    file: Pending;
    src: string | undefined;
    preview: (() => void) | undefined;
    onRemove: ((key: string) => void) | undefined;
}) {
    return (
        <Attachment state={file.state}>
            {preview === undefined ? null : <AttachmentTrigger title="Preview" onClick={preview} />}

            <AttachmentMedia>
                {file.image && src !== undefined ? (
                    <img src={src} alt="" />
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

            {onRemove === undefined ? null : (
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
            )}
        </Attachment>
    );
}

/** A picture a tool returned: the composer's card, since a run of screenshots fills a screen at full size. */
function ShotChip({ src, name, onOpen }: { src: string; name: string; onOpen: () => void }) {
    return (
        <Attachment>
            <AttachmentTrigger title="Preview" onClick={onOpen} />

            <AttachmentMedia>
                <img src={src} alt="" loading="lazy" />
            </AttachmentMedia>

            <AttachmentContent>
                <AttachmentTitle title={name}>{name}</AttachmentTitle>
            </AttachmentContent>
        </Attachment>
    );
}

/** Pictures a tool returned, as cards that open full size in the viewer. */
export function ImageThumbs({ images }: { images: { src: string; name: string }[] }) {
    const [open, setOpen] = useState<number | undefined>(undefined);

    return (
        <div className="flex flex-wrap gap-1.5">
            {images.map((image, index) => (
                <ShotChip
                    key={image.src}
                    src={image.src}
                    name={image.name}
                    onOpen={() => {
                        setOpen(index);
                    }}
                />
            ))}

            {open === undefined ? null : (
                <Suspense fallback={null}>
                    <Lightbox
                        shots={images}
                        index={open}
                        onIndex={setOpen}
                        onClose={() => {
                            setOpen(undefined);
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
}

/** What a message or the composer's row holds: one card per file, a picture's opening in the viewer. */
export function Attachments({ files, onRemove }: Props) {
    const [open, setOpen] = useState<string | undefined>(undefined);
    const photos = files.filter((file) => file.image && file.state === "done");
    const shown = photos.findIndex((file) => file.key === open);

    if (files.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 pb-2">
            {files.map((file) => {
                const src = srcOf(file);
                const preview =
                    file.image && file.state === "done"
                        ? () => {
                              setOpen(file.key);
                          }
                        : undefined;

                return (
                    <Chip
                        key={file.key}
                        file={file}
                        src={src}
                        preview={preview}
                        onRemove={onRemove}
                    />
                );
            })}

            {shown < 0 ? null : (
                <Suspense fallback={null}>
                    <Lightbox
                        shots={photos.map((file) => ({ src: srcOf(file), name: file.name }))}
                        index={shown}
                        onIndex={(index) => {
                            setOpen(photos[index]?.key);
                        }}
                        onClose={() => {
                            setOpen(undefined);
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
}
