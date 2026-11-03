import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FolderPage, FolderPanel } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";
import { pageKey } from "./pages.tsx";
import { panelKey } from "./panels.tsx";

type Item = FolderPanel | FolderPage;

function Tab({
    item,
    id,
    session,
    active,
    onSelect,
}: {
    item: Item;
    id: string;
    session: StatusProps["session"];
    active: boolean;
    onSelect: () => void;
}) {
    const Count = item.badge;

    return (
        <Button
            variant="ghost"
            size="sm"
            aria-current={active ? "true" : undefined}
            onClick={onSelect}
            className={cn("relative shrink-0", active && "text-ink")}
        >
            {item.icon}
            {item.title}
            {Count === undefined ? null : (
                <Badge
                    tone="accent"
                    className="pointer-events-none h-3.5 min-w-3.5 justify-center px-1 leading-none empty:hidden"
                >
                    <ItemBoundary name={`${id}:badge`}>
                        <Count session={session} />
                    </ItemBoundary>
                </Badge>
            )}
            {active ? (
                <span aria-hidden className="bg-accent h-stripe absolute inset-x-0 bottom-0" />
            ) : null}
        </Button>
    );
}

/**
 * One tab per extension panel, then one per page. The strip is the top row of the right sidebar and,
 * while a page is open, of the page; the active tab is the open panel or page.
 */
export function ExtensionTabs({
    panels,
    pages,
    session,
    panel,
    page,
    onPanel,
    onPage,
}: {
    panels: readonly FolderPanel[];
    pages: readonly FolderPage[];
    session: StatusProps["session"];
    panel: string | null;
    page: string | null;
    onPanel: (key: string) => void;
    onPage: (key: string) => void;
}): ReactNode {
    return (
        <nav aria-label="Extensions" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {panels.map((item) => {
                const key = panelKey(item);

                return (
                    <Tab
                        key={`panel:${key}`}
                        item={item}
                        id={key}
                        session={session}
                        active={panel === key}
                        onSelect={() => {
                            onPanel(key);
                        }}
                    />
                );
            })}
            {pages.map((item) => {
                const key = pageKey(item);

                return (
                    <Tab
                        key={`page:${key}`}
                        item={item}
                        id={key}
                        session={session}
                        active={page === key}
                        onSelect={() => {
                            onPage(key);
                        }}
                    />
                );
            })}
        </nav>
    );
}
