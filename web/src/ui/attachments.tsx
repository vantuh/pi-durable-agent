import { ChevronLeft, ChevronRight, Paperclip, TriangleAlert, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

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
    onRemove?: (key: string) => void;
};

type Shot = { src: string | undefined; name: string };

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

function StepButton({
    side,
    disabled,
    onClick,
}: {
    side: "previous" | "next";
    disabled: boolean;
    onClick: () => void;
}) {
    const Icon = side === "previous" ? ChevronLeft : ChevronRight;
    const label = side === "previous" ? "Previous photo" : "Next photo";

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-disabled={disabled}
            onClick={() => {
                if (!disabled) {
                    onClick();
                }
            }}
            className={`rounded-control bg-sunken/30 text-muted focus-visible:ring-accent hover:bg-sunken/60 hover:text-ink focus-visible:bg-sunken/60 focus-visible:text-ink aria-disabled:bg-sunken/30 aria-disabled:text-muted absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center opacity-70 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 aria-disabled:cursor-default aria-disabled:opacity-30 ${side === "previous" ? "left-1.5" : "right-1.5"}`}
        >
            <Icon className="size-5" />
        </button>
    );
}

/** One picture full size. With several: arrows and ArrowLeft/ArrowRight step between them, without wrapping. */
function Lightbox({
    shots,
    index,
    onIndex,
    onClose,
}: {
    shots: Shot[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
}) {
    const content = useRef<HTMLDivElement>(null);
    const shot = shots[index];
    const many = shots.length > 1;

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const next = index + step;

        if (many && step !== 0) {
            event.preventDefault();
            event.currentTarget.focus();

            if (next >= 0 && next < shots.length) {
                onIndex(next);
            }
        }
    }

    if (shot === undefined) {
        return null;
    }

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
                ref={content}
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    content.current?.focus();
                }}
                onKeyDown={onKeyDown}
                className="bg-panel border-edge rounded-card inset-auto top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-auto max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-1.5 border p-1.5 sm:max-h-[calc(100dvh-2rem)] sm:w-auto sm:max-w-[calc(100vw-2rem)]"
            >
                <DialogTitle className="sr-only">{shot.name}</DialogTitle>
                <div className="relative flex justify-center">
                    <img
                        src={shot.src}
                        alt={shot.name}
                        className="rounded-control max-h-[calc(100dvh-8rem)] max-w-full object-contain"
                    />
                    {many ? (
                        <>
                            <StepButton
                                side="previous"
                                disabled={index === 0}
                                onClick={() => {
                                    onIndex(index - 1);
                                }}
                            />
                            <StepButton
                                side="next"
                                disabled={index === shots.length - 1}
                                onClick={() => {
                                    onIndex(index + 1);
                                }}
                            />
                        </>
                    ) : null}
                </div>
                <div className="text-meta text-muted flex min-w-0 items-center gap-3 px-1">
                    <p className="min-w-0 flex-1 truncate font-mono">{shot.name}</p>
                    {many ? (
                        <p className="shrink-0 tabular-nums" aria-live="polite">
                            {index + 1} / {shots.length}
                        </p>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Pictures a tool returned, as thumbnails that open full size. */
export function ImageThumbs({ images }: { images: { src: string; name: string }[] }) {
    const [open, setOpen] = useState<number | undefined>(undefined);

    return (
        <div className="flex flex-wrap gap-1.5">
            {images.map((image, index) => (
                <button
                    key={image.src}
                    type="button"
                    title="Preview"
                    onClick={() => {
                        setOpen(index);
                    }}
                    className="rounded-control border-edge-soft bg-sunken hover:border-edge cursor-zoom-in overflow-hidden border"
                >
                    <img
                        src={image.src}
                        alt={image.name}
                        loading="lazy"
                        className="block max-h-40 max-w-full object-contain"
                    />
                </button>
            ))}

            {open === undefined ? null : (
                <Lightbox
                    shots={images}
                    index={open}
                    onIndex={setOpen}
                    onClose={() => {
                        setOpen(undefined);
                    }}
                />
            )}
        </div>
    );
}

export function Attachments({ files, onRemove }: Props) {
    const [open, setOpen] = useState<string | undefined>(undefined);
    const photos = files.filter((file) => file.image && file.state === "done");
    const shown = photos.findIndex((file) => file.key === open);

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
                                setOpen(file.key);
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
            ))}

            {shown < 0 ? null : (
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
            )}
        </div>
    );
}
