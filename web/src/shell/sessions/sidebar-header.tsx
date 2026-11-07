import { PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SheetTitle } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/tooltip";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import { CommandKeys } from "@/ui/command-keys.tsx";

import { FADE } from "./rail.ts";
import type { useSessionSearch } from "./use-session-search.ts";

export function SidebarHeader({
    asSheet,
    current,
    search,
    controls,
    onToggleCollapsed,
    onHome,
    onNew,
    onClose,
}: {
    asSheet: boolean;
    /** Null on the home page. */
    current: number | null;
    search: ReturnType<typeof useSessionSearch>;
    /** What narrows the list (the extensions' filters, the archive switch), before the buttons that act on it. */
    controls: ReactNode;
    onToggleCollapsed: () => void;
    onHome: () => void;
    onNew: () => void;
    onClose: () => void;
}) {
    const { searching, query, setQuery, searchBox, searchTrigger, startSearch, stopSearch } =
        search;
    // The sheet's dialog needs a title; the column has no dialog, so there it stays a plain heading.
    const Heading = asSheet ? SheetTitle : "h2";

    return (
        <header className="border-edge-soft @container relative flex items-center gap-2 px-3 py-2.5 transition-[padding] duration-200 lg:group-data-[collapsed]/side:flex-col lg:group-data-[collapsed]/side:gap-1 lg:group-data-[collapsed]/side:border-b lg:group-data-[collapsed]/side:px-1.5">
            {/* The rail has room for one button: there the logo expands, and shows it on hover. */}
            <Hint label="Expand sidebar">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Expand sidebar"
                    onClick={onToggleCollapsed}
                    className="group/logo hidden size-6 shrink-0 lg:group-data-[collapsed]/side:inline-flex"
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        className="size-5 group-hover/logo:hidden group-focus-visible/logo:hidden"
                    />
                    <PanelLeftOpen className="hidden size-4 group-hover/logo:block group-focus-visible/logo:block" />
                </Button>
            </Hint>
            <Hint label="Home: every session">
                <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    className="relative -my-1 -ml-1 size-8 shrink-0 lg:group-data-[collapsed]/side:hidden"
                >
                    <a
                        href={sessionHref(null)}
                        onClick={(event) => {
                            if (isPlainClick(event)) {
                                event.preventDefault();
                                onHome();
                            }
                        }}
                        aria-label="Home"
                        aria-current={current === null ? "page" : undefined}
                    >
                        <img src="/favicon.png" alt="" className="size-6" />
                        {current === null ? (
                            <span
                                aria-hidden
                                className="bg-accent absolute inset-x-0 bottom-0 h-0.5"
                            />
                        ) : null}
                    </a>
                </Button>
            </Hint>
            <Heading
                // Under 18rem the header's icons leave no room for the word, and a clipped one reads worse than none.
                className={`text-ui text-ink min-w-0 flex-1 overflow-hidden font-medium whitespace-nowrap lg:group-data-[collapsed]/side:hidden @max-2xs:sr-only ${FADE}`}
            >
                Sessions
            </Heading>
            <div className="ml-auto flex items-center gap-1 lg:group-data-[collapsed]/side:hidden">
                {controls}
                <Hint label="Search sessions" keys={<CommandKeys command="session.search" />}>
                    <Button
                        ref={searchTrigger}
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Search sessions"
                        aria-expanded={searching}
                        onClick={() => {
                            startSearch();
                        }}
                    >
                        <Search className="size-4" />
                    </Button>
                </Hint>
                <Separator orientation="vertical" className="mx-1 h-4 self-center" />
                <Hint label="New session">
                    <Button variant="ghost" size="icon-sm" aria-label="New session" onClick={onNew}>
                        <Plus className="size-4" />
                    </Button>
                </Hint>
                <Hint label="Collapse sidebar">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Collapse sidebar"
                        onClick={onToggleCollapsed}
                        className="hidden shrink-0 lg:inline-flex"
                    >
                        <PanelLeftClose className="size-4" />
                    </Button>
                </Hint>
                <Hint label="Close">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close"
                        onClick={onClose}
                        className="lg:hidden"
                    >
                        <X className="size-4" />
                    </Button>
                </Hint>
            </div>
            <div
                className={`bg-panel absolute inset-0 flex items-center px-3 py-2 transition-opacity duration-200 lg:group-data-[collapsed]/side:hidden ${searching ? "opacity-100" : "pointer-events-none opacity-0"}`}
            >
                <Search className="text-faint pointer-events-none absolute left-5 size-3.5" />
                <Input
                    ref={searchBox}
                    type="search"
                    value={query}
                    aria-label="Search sessions"
                    placeholder="Search sessions"
                    tabIndex={searching ? undefined : -1}
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            // The key is this field's: it must not also leave the panel's full screen.
                            event.stopPropagation();
                            stopSearch();
                        }
                    }}
                    className="border-edge-soft text-ui h-full pr-7 pl-7 [&::-webkit-search-cancel-button]:hidden"
                />
                <Hint label="Close search">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close search"
                        onClick={stopSearch}
                        tabIndex={searching ? undefined : -1}
                        className="absolute top-1/2 right-4.5 -translate-y-1/2"
                    >
                        <X className="size-3.5" />
                    </Button>
                </Hint>
            </div>
        </header>
    );
}
