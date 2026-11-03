import { ArrowLeft, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

import type { FolderPage } from "../extensions.ts";
import type { PageProps, StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export const pageKey = (page: FolderPage): string => `${page.folder}:${page.id}`;

/** A sub-location's parent: the page root for one segment, or the sub without its last segment. */
export function parentSub(sub: string): string | undefined {
    const cut = sub.lastIndexOf("/");

    return cut === -1 ? undefined : sub.slice(0, cut);
}

/** One header button per page; the open one stays raised. */
export function PageButtons({
    pages,
    session,
    open,
    onOpen,
}: {
    pages: readonly FolderPage[];
    session: StatusProps["session"];
    open: string | null;
    onOpen: (key: string, opener: HTMLButtonElement) => void;
}) {
    return pages.map((page) => {
        const key = pageKey(page);
        const Count = page.badge;

        return (
            <Hint key={key} label={page.title}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={page.title}
                    aria-pressed={open === key}
                    onClick={(event) => {
                        onOpen(key, event.currentTarget);
                    }}
                    className={`relative ${open === key ? "bg-raised text-ink" : ""}`}
                >
                    {page.icon}
                    {Count === undefined ? null : (
                        <Badge
                            tone="accent"
                            className="pointer-events-none absolute -top-1 -right-1 h-3.5 min-w-3.5 justify-center px-1 leading-none empty:hidden"
                        >
                            <ItemBoundary name={`${key}:badge`}>
                                <Count session={session} />
                            </ItemBoundary>
                        </Badge>
                    )}
                </Button>
            </Hint>
        );
    });
}

/**
 * The open page, in place of the conversation. The frame is ours: an arrow to the parent only when
 * the address has a sub-location, and a close button that always returns to the conversation. The
 * body is the extension's; it fills the area and does not scroll, so the page owns its one scroll.
 */
export function PageHost({
    page,
    session,
    sub,
    onSub,
    onBack,
    onClose,
}: {
    page: FolderPage;
    session: NonNullable<StatusProps["session"]>;
    sub: string | undefined;
    onSub: (sub: string | undefined) => void;
    /** The parent sub-location; `undefined` is the page root. Only called when `sub` is set. */
    onBack: (parent: string | undefined) => void;
    onClose: (focus?: "composer") => void;
}) {
    const Body = page.component;
    const host = useRef<HTMLElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const props: PageProps = {
        session,
        sub,
        navigate: onSub,
        close: (focus) => {
            onClose(focus);
        },
    };

    // The frame's title is the landing place, unless the page's own body took the keyboard first:
    // a commit's title or a review layer says more than the frame does.
    useEffect(() => {
        if (!host.current?.contains(document.activeElement)) {
            heading.current?.focus();
        }
    }, []);

    return (
        <section
            ref={host}
            data-slot="page-host"
            className="rounded-card border-edge-soft bg-canvas absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col border"
        >
            <header className="border-edge-soft min-h-header flex items-center gap-2 border-b px-3 py-0.5">
                {sub === undefined ? null : (
                    <Hint label="Back">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Back"
                            onClick={() => {
                                onBack(parentSub(sub));
                            }}
                            className="shrink-0"
                        >
                            <ArrowLeft className="size-4" />
                        </Button>
                    </Hint>
                )}
                <h2
                    ref={heading}
                    tabIndex={-1}
                    className="text-interface text-ink min-w-0 flex-1 truncate leading-5 font-medium outline-none"
                >
                    {page.title}
                </h2>
                <Hint label="Close">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close"
                        onClick={() => {
                            onClose();
                        }}
                        className="shrink-0"
                    >
                        <X className="size-4" />
                    </Button>
                </Hint>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
                <ItemBoundary name={pageKey(page)}>
                    <Body key={session.id} {...props} />
                </ItemBoundary>
            </div>
        </section>
    );
}
