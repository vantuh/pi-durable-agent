import { Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { UploadedFile } from "../lib/api.ts";

type Props = {
    files: UploadedFile[];
    onRemove: (path: string) => void;
};

function size(bytes: number): string {
    return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function Lightbox({ file, onClose }: { file: UploadedFile; onClose: () => void }) {
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
                    src={`/api/uploads?path=${encodeURIComponent(file.path)}`}
                    alt={file.name}
                    className="rounded-card max-h-[calc(100dvh-6rem)] max-w-full object-contain"
                />
                <p className="text-meta text-muted max-w-full truncate font-mono">{file.name}</p>
            </div>
        </div>
    );
}

export function Attachments({ files, onRemove }: Props) {
    const [open, setOpen] = useState<UploadedFile | undefined>(undefined);

    if (files.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 pb-2">
            {files.map((file) => {
                const image = file.mime !== null;

                return (
                    <span
                        key={file.path}
                        className="rounded-control border-edge-soft bg-raised flex max-w-full items-center gap-1.5 border py-0.5 pr-1 pl-1"
                    >
                        <button
                            type="button"
                            disabled={!image}
                            title={image ? "Preview" : file.name}
                            onClick={() => {
                                setOpen(file);
                            }}
                            className={`flex min-w-0 items-center gap-1.5 ${image ? "cursor-zoom-in" : "cursor-default"}`}
                        >
                            {image ? (
                                <img
                                    src={`/api/uploads?path=${encodeURIComponent(file.path)}`}
                                    alt=""
                                    className="rounded-control size-6 shrink-0 object-cover"
                                />
                            ) : (
                                <Paperclip className="text-faint size-3.5 shrink-0" />
                            )}
                            <span className="text-ink text-meta max-w-[10rem] min-w-0 truncate font-mono">
                                {file.name}
                            </span>
                            <span className="text-faint text-meta shrink-0">{size(file.size)}</span>
                        </button>

                        <button
                            type="button"
                            title="Remove"
                            onClick={() => {
                                onRemove(file.path);
                            }}
                            className="text-muted hover:text-ink flex size-5 shrink-0 items-center justify-center"
                        >
                            <X className="size-3" />
                        </button>
                    </span>
                );
            })}

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
