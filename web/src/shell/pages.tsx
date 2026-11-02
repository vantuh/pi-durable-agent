import { ArrowLeft } from "lucide-react";

import type { FolderPage } from "../extensions.ts";
import type { PageProps, StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export const pageKey = (page: FolderPage): string => `${page.folder}:${page.id}`;

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
    onOpen: (key: string) => void;
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
                onClick={() => {
                    onOpen(key);
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
 * The open page, in place of the conversation. The frame and the way back are ours; the body is the
 * extension's. The body fills the area and does not scroll: the page owns its one scroll, so a page
 * with two views keeps each view's place.
 */
export function PageHost({
    page,
    session,
    sub,
    onSub,
    onClose,
}: {
    page: FolderPage;
    session: NonNullable<StatusProps["session"]>;
    sub: string | undefined;
    onSub: (sub: string | undefined) => void;
    onClose: () => void;
}) {
    const Body = page.component;
    const props: PageProps = { session, sub, navigate: onSub, close: onClose };

    return (
        <section
            data-slot="page-host"
            className="rounded-card border-edge-soft bg-canvas absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col border"
        >
            <header className="border-edge-soft flex min-h-[45px] items-center gap-2 border-b px-3 py-0.5">
                <button
                    type="button"
                    title="Back to conversation"
                    aria-label="Back to conversation"
                    onClick={onClose}
                    className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 shrink-0 items-center justify-center"
                >
                    <ArrowLeft className="size-4" />
                </button>
                <h2 className="text-interface text-ink truncate leading-5 font-medium">
                    {page.title}
                </h2>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
                <ItemBoundary name={pageKey(page)}>
                    <Body key={session.id} {...props} />
                </ItemBoundary>
            </div>
        </section>
    );
}
