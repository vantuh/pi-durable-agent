import { ChevronDown, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

import { refreshExtensions } from "../extensions.ts";
import { type ExtensionInfo, listExtensions, setExtensionEnabled } from "../lib/api.ts";
import { ExtensionDetails, hasExtensionDetails } from "./extension-details.tsx";

/** The icon button for the Settings footer, and the modal it opens. */
export function ExtensionsButton() {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    type="button"
                    title="Extensions"
                    aria-label="Extensions"
                    className="rounded-control text-muted hover:bg-raised focus-visible:ring-accent flex size-7 items-center justify-center outline-none focus-visible:ring-2"
                >
                    <Puzzle className="size-4" />
                </button>
            </DialogTrigger>
            <DialogContent className="sm:h-[min(36rem,80dvh)] sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Extensions</DialogTitle>
                    <DialogDescription>
                        Turn a feature on or off. It applies at once.
                    </DialogDescription>
                </DialogHeader>
                <ExtensionList />
            </DialogContent>
        </Dialog>
    );
}

type Failure = { name: string; message: string };

function ExtensionList() {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [rows, setRows] = useState<ExtensionInfo[] | undefined>(undefined);
    const [loadError, setLoadError] = useState<string | undefined>(undefined);
    const [failure, setFailure] = useState<Failure | undefined>(undefined);

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const found = await listExtensions();

                if (alive) {
                    setRows(found);
                }
            } catch (error) {
                if (alive) {
                    setLoadError(error instanceof Error ? error.message : "could not load");
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const replace = (info: ExtensionInfo): void => {
        setRows((current) => current?.map((row) => (row.name === info.name ? info : row)));
    };

    const toggle = async (row: ExtensionInfo, enabled: boolean): Promise<void> => {
        setFailure(undefined);
        replace({ ...row, enabled });

        try {
            replace(await setExtensionEnabled(row.name, enabled));
            await refreshExtensions();
        } catch (error) {
            replace(row);
            setFailure({
                name: row.name,
                message: error instanceof Error ? error.message : "the change failed",
            });
        }
    };

    if (rows === undefined) {
        return (
            <p
                className={`text-meta p-3 ${loadError === undefined ? "text-faint" : "text-danger"}`}
            >
                {loadError ?? "Loading…"}
            </p>
        );
    }

    return (
        <ScrollArea className="min-h-0 flex-1">
            <ul className="divide-edge-soft flex flex-col divide-y">
                {rows.map((row) => {
                    const problem = failure?.name === row.name ? failure.message : row.error;

                    return (
                        <li key={row.name} className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    {hasExtensionDetails(row.name) ? (
                                        <button
                                            type="button"
                                            aria-expanded={expanded.has(row.name)}
                                            aria-controls={`${row.name}-details`}
                                            className="text-interface text-ink focus-visible:ring-accent flex items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2"
                                            onClick={() =>
                                                setExpanded((current) => {
                                                    const next = new Set(current);
                                                    if (next.has(row.name)) {
                                                        next.delete(row.name);
                                                    } else {
                                                        next.add(row.name);
                                                    }
                                                    return next;
                                                })
                                            }
                                        >
                                            <ChevronDown
                                                className={`size-3 shrink-0 transition-transform ${expanded.has(row.name) ? "" : "-rotate-90"}`}
                                            />
                                            {row.title}
                                        </button>
                                    ) : (
                                        <span className="text-interface text-ink">{row.title}</span>
                                    )}
                                    {row.description === "" ? null : (
                                        <span
                                            id={`${row.name}-description`}
                                            className="text-meta text-muted"
                                        >
                                            {row.description}
                                        </span>
                                    )}
                                    {problem === undefined ? null : (
                                        <span
                                            id={`${row.name}-problem`}
                                            role="alert"
                                            className="text-meta text-danger break-words"
                                        >
                                            {problem}
                                        </span>
                                    )}
                                </div>
                                <Switch
                                    checked={row.enabled}
                                    aria-label={`Enable ${row.title}`}
                                    aria-describedby={
                                        [
                                            row.description === ""
                                                ? undefined
                                                : `${row.name}-description`,
                                            problem === undefined
                                                ? undefined
                                                : `${row.name}-problem`,
                                        ]
                                            .filter((id) => id !== undefined)
                                            .join(" ") || undefined
                                    }
                                    onCheckedChange={(enabled) => {
                                        void toggle(row, enabled);
                                    }}
                                />
                            </div>
                            {hasExtensionDetails(row.name) && expanded.has(row.name) ? (
                                <div
                                    id={`${row.name}-details`}
                                    className="border-edge-soft mt-3 border-t pt-3"
                                >
                                    <ExtensionDetails
                                        folder={row.name}
                                        enabled={row.enabled}
                                        installed={row.installed}
                                    />
                                </div>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </ScrollArea>
    );
}
