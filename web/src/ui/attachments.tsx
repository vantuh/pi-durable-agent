import { ChevronLeft, ChevronRight, Paperclip, TriangleAlert, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

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
    /** A picture the size the message can give it, not a chip: the transcript. */
    large?: boolean;
};

type Shot = { src: string | undefined; name: string };

/** A photo as wide as its message: a phone screenshot is unreadable in a chip. */
const PHOTO = "block max-h-[min(60dvh,26rem)] w-auto max-w-full object-contain";

/** A picture a tool returned: smaller than a photo sent by hand, still seen without opening it. */
const THUMB = "block max-h-[min(50dvh,20rem)] max-w-full object-contain";

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

/**
 * One picture, as big as the screen allows: the wheel or a pinch zooms it, a drag moves it, and a
 * double click or tap puts it back whole. With several, arrows and ArrowLeft/ArrowRight step between
 * them, without wrapping.
 */
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
                className="bg-panel border-edge gap-1.5 p-1.5 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[calc(100vw-2rem)] sm:max-w-6xl"
            >
                <DialogTitle className="sr-only">{shot.name}</DialogTitle>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {/* A new picture starts whole: the wrapper is keyed by it. */}
                    <TransformWrapper
                        key={shot.src}
                        minScale={1}
                        maxScale={8}
                        wheel={{ step: 0.002 }}
                        doubleClick={{ mode: "reset" }}
                        panning={{ velocityDisabled: true }}
                        keyboard={{ disabled: true }}
                    >
                        <TransformComponent
                            wrapperStyle={{ width: "100%", height: "100%", touchAction: "none" }}
                            contentStyle={{ width: "100%", height: "100%" }}
                            contentClass="items-center justify-center"
                        >
                            <img
                                src={shot.src}
                                alt={shot.name}
                                className="block max-h-full max-w-full object-contain"
                            />
                        </TransformComponent>
                    </TransformWrapper>
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

/** A photo in a message: the picture, then its name and weight. Tap it to open it full size. */
function Photo({
    src,
    name,
    bytes,
    onOpen,
    onRemove,
}: {
    src: string;
    name: string;
    bytes: number;
    onOpen: () => void;
    onRemove: (() => void) | undefined;
}) {
    return (
        <figure className="rounded-control border-edge-soft bg-sunken max-w-full overflow-hidden border">
            <button
                type="button"
                title="Preview"
                aria-label={`Preview ${name}`}
                onClick={onOpen}
                className="block max-w-full cursor-zoom-in"
            >
                <img src={src} alt={name} className={PHOTO} />
            </button>
            <figcaption className="text-faint flex min-w-0 items-center gap-2 px-2 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                <span className="shrink-0 tabular-nums">{size(bytes)}</span>
                {onRemove === undefined ? null : (
                    <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${name}`}
                        onClick={onRemove}
                        className="hover:text-ink -mr-0.5 flex size-4 shrink-0 items-center justify-center"
                    >
                        <X className="size-3" />
                    </button>
                )}
            </figcaption>
        </figure>
    );
}

/** A file as a card, its picture a chip: the composer's row, and the transcript's files that are not pictures. */
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

/** Pictures a tool returned, as previews that open full size. */
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
                    className="rounded-control border-edge-soft bg-sunken hover:border-edge max-w-full cursor-zoom-in overflow-hidden border"
                >
                    <img src={image.src} alt={image.name} loading="lazy" className={THUMB} />
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

export function Attachments({ files, onRemove, large = false }: Props) {
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

                return large && src !== undefined && preview !== undefined ? (
                    <Photo
                        key={file.key}
                        src={src}
                        name={file.name}
                        bytes={file.size}
                        onOpen={preview}
                        onRemove={
                            onRemove === undefined
                                ? undefined
                                : () => {
                                      onRemove(file.key);
                                  }
                        }
                    />
                ) : (
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
