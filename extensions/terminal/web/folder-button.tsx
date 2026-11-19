import { SquareTerminal } from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SidebarFolderProps } from "@/sdk/types.ts";

import { TERMINAL_PAGE } from "../refs.ts";
import { useFolderTabs } from "./use-folder-tabs.ts";

/** How long the menu waits for the pointer to cross from the icon to the menu, or back, before it closes. */
const LEAVE_MS = 150;

/**
 * The folder's terminal tabs on its sidebar header: the icon with their count, and a list of them that a mouse
 * opens on hover and a finger or a key opens with a tap or Enter. A folder without a tab shows nothing.
 */
export function FolderTerminals({ cwd, openPage }: SidebarFolderProps) {
    const tabs = useFolderTabs(cwd);
    const [open, setOpen] = useState(false);
    const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Opened by hover, the list leaves the keyboard where it was: the composer keeps its caret.
    const byHover = useRef(false);
    const mouse = useRef(false);
    const list = useRef<HTMLDivElement>(null);

    if (tabs.length === 0) {
        return null;
    }

    const hover = (inside: boolean) => (event: PointerEvent) => {
        if (event.pointerType !== "mouse") {
            return;
        }

        clearTimeout(leaving.current);

        if (inside) {
            byHover.current ||= !open;
            setOpen(true);
        } else {
            leaving.current = setTimeout(() => {
                setOpen(false);
            }, LEAVE_MS);
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                byHover.current = false;
                setOpen(next);
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Terminals: ${String(tabs.length)}`}
                    className="relative shrink-0"
                    onPointerEnter={hover(true)}
                    onPointerLeave={hover(false)}
                    onPointerDown={(event) => {
                        mouse.current = event.pointerType === "mouse";
                    }}
                    onClick={(event) => {
                        // Hover already opened it: a mouse click must not toggle it shut again.
                        if (mouse.current) {
                            mouse.current = false;
                            event.preventDefault();
                            setOpen(true);
                        }
                    }}
                >
                    <SquareTerminal className="size-3.5" />
                    <Badge
                        tone="accent"
                        size="count"
                        className="pointer-events-none absolute -top-1 -right-1"
                    >
                        {tabs.length}
                    </Badge>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                size="menu"
                className="w-56"
                aria-label="Terminals"
                onPointerEnter={hover(true)}
                onPointerLeave={hover(false)}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();

                    if (!byHover.current) {
                        list.current?.focus();
                    }
                }}
            >
                <Command ref={list} label="Terminals" className="outline-none">
                    <CommandList label="Terminals">
                        {tabs.map((tab) => (
                            <CommandItem
                                key={tab.id}
                                value={String(tab.id)}
                                onSelect={() => {
                                    setOpen(false);
                                    openPage(TERMINAL_PAGE, String(tab.id));
                                }}
                            >
                                <SquareTerminal className="text-faint size-3.5 shrink-0" />
                                <span className="text-meta flex-1 truncate font-mono">
                                    {tab.title}
                                </span>
                                {tab.exited ? (
                                    <span className="text-meta text-faint">stopped</span>
                                ) : null}
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
