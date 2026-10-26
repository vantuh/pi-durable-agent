import { Folder } from "lucide-react";

type Props = {
    cwd: string;
    title: string | null;
    busy: boolean;
};

function folderName(cwd: string): string {
    if (cwd === "") {
        return "no folder";
    }

    const parts = cwd.split("/");

    return parts[parts.length - 1] ?? cwd;
}

export function Sessions({ cwd, title, busy }: Props) {
    return (
        <aside className="rounded-card border-edge-soft bg-canvas hidden w-[264px] shrink-0 flex-col border lg:flex">
            <header className="border-edge-soft flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">Sessions</h2>
                <span className="bg-raised text-meta text-muted flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1">
                    <Folder className="size-3 shrink-0" />
                    <span className="truncate font-mono">{folderName(cwd)}</span>
                </span>
            </header>

            <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
                <div className="text-meta text-faint px-2 py-1.5">Today 1</div>
                <button
                    type="button"
                    className="rounded-control bg-raised flex w-full items-center gap-2 px-2 py-2 text-left"
                >
                    <span
                        className={`size-2 shrink-0 rounded-full ${busy ? "bg-warn" : "bg-faint"}`}
                    />
                    <span className="text-interface text-ink min-w-0 flex-1 truncate">
                        {title ?? "New session"}
                    </span>
                    <span className="text-meta text-faint shrink-0">now</span>
                </button>
            </nav>
        </aside>
    );
}
