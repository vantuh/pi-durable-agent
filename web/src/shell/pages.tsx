import { ArrowLeft, X } from "lucide-react";
import { useEffect, useRef } from "react";

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
        const Badge = page.badge;

        return (
            <button
                key={key}
                type="button"
                title={page.title}
                aria-pressed={open === key}
                onClick={(event) => {
                    onOpen(key, event.currentTarget);
                }}
                className={`rounded-control hover:bg-raised hover:text-ink relative flex size-6 items-center justify-center ${open === key ? "bg-raised text-ink" : "text-muted"}`}
            >
                {page.icon}
                {Badge === undefined ? null : (
                    <span className="bg-accent text-on-accent text-meta pointer-events-none absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 leading-none empty:hidden">
                        <ItemBoundary name={`${key}:badge`}>
                            <Badge session={session} />
                        </ItemBoundary>
                    </span>
                )}
            </button>
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
            <header className="border-edge-soft flex min-h-[45px] items-center gap-2 border-b px-3 py-0.5">
                {sub === undefined ? null : (
                    <button
                        type="button"
                        title="Back"
                        aria-label="Back"
                        onClick={() => {
                            onBack(parentSub(sub));
                        }}
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 shrink-0 items-center justify-center"
                    >
                        <ArrowLeft className="size-4" />
                    </button>
                )}
                <h2
                    ref={heading}
                    tabIndex={-1}
                    className="text-interface text-ink min-w-0 flex-1 truncate leading-5 font-medium outline-none"
                >
                    {page.title}
                </h2>
                <button
                    type="button"
                    title="Close"
                    aria-label="Close"
                    onClick={() => {
                        onClose();
                    }}
                    className="rounded-control text-muted hover:bg-raised flex size-6 shrink-0 items-center justify-center"
                >
                    <X className="size-4" />
                </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
                <ItemBoundary name={pageKey(page)}>
                    <Body key={session.id} {...props} />
                </ItemBoundary>
            </div>
        </section>
    );
}
