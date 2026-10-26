import { X } from "lucide-react";

import type { UploadedFile } from "../lib/api.ts";

type Props = {
    files: UploadedFile[];
    onRemove: (path: string) => void;
};

function size(bytes: number): string {
    return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function Attachments({ files, onRemove }: Props) {
    if (files.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-1.5 pb-2">
            {files.map((file) => (
                <div
                    key={file.path}
                    className="rounded-control border-edge-soft bg-raised flex items-center gap-2 border px-1.5 py-1"
                >
                    {file.mime === null ? (
                        <div className="rounded-control bg-sunken size-8 shrink-0" />
                    ) : (
                        <img
                            src={`/api/uploads?path=${encodeURIComponent(file.path)}`}
                            alt=""
                            className="rounded-control size-8 shrink-0 object-cover"
                        />
                    )}

                    <span className="text-ink text-meta min-w-0 flex-1 truncate font-mono">
                        {file.name}
                    </span>
                    <span className="text-faint text-meta shrink-0">{size(file.size)}</span>

                    <button
                        type="button"
                        title="Remove"
                        onClick={() => {
                            onRemove(file.path);
                        }}
                        className="text-muted hover:text-ink flex size-6 shrink-0 items-center justify-center"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}
