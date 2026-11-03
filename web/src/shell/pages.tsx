import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

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

/**
 * The open page, in place of the conversation. The frame is ours: the extension tabs, an arrow to the
 * parent only when the address has a sub-location, and a close button that always returns to the
 * conversation. The
 * body is the extension's; it fills the area and does not scroll, so the page owns its one scroll.
 */
export function PageHost({
    page,
    tabs,
    session,
    sub,
    onSub,
    onBack,
    onClose,
}: {
    page: FolderPage;
    tabs: ReactNode;
    session: NonNullable<StatusProps["session"]>;
    sub: string | undefined;
    onSub: (sub: string | undefined) => void;
    /** The parent sub-location; `undefined` is the page root. Only called when `sub` is set. */
    onBack: (parent: string | undefined) => void;
    onClose: (focus?: "composer") => void;
}) {
    const Body = page.component;
    const host = useRef<HTMLElement>(null);
    const props: PageProps = {
        session,
        sub,
        navigate: onSub,
        close: (focus) => {
            onClose(focus);
        },
    };

    // The page's own tab is the landing place, unless the page's own body took the keyboard first:
    // a commit's title or a review layer says more than the frame does.
    useEffect(() => {
        if (!host.current?.contains(document.activeElement)) {
            host.current?.querySelector<HTMLElement>("[aria-current]")?.focus();
        }
    }, []);

    return (
        <section
            ref={host}
            data-slot="page-host"
            className={`bg-canvas absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col`}
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
                {tabs}
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
