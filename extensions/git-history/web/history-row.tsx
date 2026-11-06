import { ArrowDown, ArrowUp, Check, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";

import { WORKING } from "../refs.ts";
import { EXACT_TIME } from "./exact-time.ts";

/** A row of the list: the whole row opens the commit. */
export function HistoryRow({
    target,
    title,
    detail,
    at,
    marker,
    viewed,
    seen,
    onOpen,
    onPrefetch,
    onUnread,
    rowRef,
}: {
    target: string;
    title: string;
    detail: string;
    at: number | undefined;
    marker: "local" | "remote" | undefined;
    viewed: boolean;
    /** Already read: the row keeps a tick, as the last one keeps the ring. */
    seen: boolean;
    onOpen: (target: string) => void;
    onPrefetch: (target: string | undefined) => void;
    onUnread: (target: string) => void;
    rowRef: (element: HTMLButtonElement | null) => void;
}) {
    return (
        <li className="border-edge-soft relative border-b">
            <Item asChild>
                <Button
                    ref={rowRef}
                    variant="ghost"
                    onClick={() => {
                        onOpen(target);
                    }}
                    onPointerEnter={() => {
                        onPrefetch(target === WORKING ? undefined : target);
                    }}
                    onPointerLeave={() => {
                        onPrefetch(undefined);
                    }}
                    onFocus={() => {
                        onPrefetch(target === WORKING ? undefined : target);
                    }}
                    aria-current={viewed ? "true" : undefined}
                    className={`w-full min-w-0 justify-start py-2 pl-3 text-left focus-visible:ring-inset ${seen ? "pr-14" : "pr-3"} ${viewed ? "ring-accent ring-1 ring-inset" : ""}`}
                >
                    {/* Spans, not the primitive's parts: a `<button>` takes phrasing content only. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-interface text-ink flex items-center gap-1.5 leading-tight font-medium">
                            {marker === "local" ? (
                                <ArrowUp
                                    className="text-ok size-3 shrink-0"
                                    aria-label="Not pushed"
                                />
                            ) : marker === "remote" ? (
                                <ArrowDown
                                    className="text-info size-3 shrink-0"
                                    aria-label="Not pulled"
                                />
                            ) : null}
                            <span className="truncate">{title}</span>
                        </span>
                        <span
                            className="text-meta text-faint block truncate font-mono leading-tight"
                            title={at === undefined ? undefined : EXACT_TIME.format(at)}
                        >
                            {detail}
                        </span>
                    </span>
                    <ChevronRight className="text-faint size-4 shrink-0" />
                </Button>
            </Item>
            {/* Over the row, not in it: a button holds phrasing content, and a press here takes the tick back. */}
            {seen ? (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mark as not read"
                    title="Mark as not read"
                    onClick={() => {
                        onUnread(target);
                    }}
                    className="text-ok absolute top-1/2 right-7 -translate-y-1/2"
                >
                    <Check className="size-3.5" />
                </Button>
            ) : null}
        </li>
    );
}
