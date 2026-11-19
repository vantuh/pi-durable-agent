import { ArrowDown, ArrowUp, Check, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type FolderFolderMenuItem, useFolderMenu } from "@/extensions.ts";

import { FOLDER_COLORS, type FolderColor } from "../../../../shared/folders.ts";
import { FOLDER_DOT } from "./folder-tones.ts";

/** The `⋯` of a `group/folder` row. A mouse shows it on hover; a finger has no hover, so it is always there. */
export const MENU_TRIGGER =
    "shrink-0 lg:group-data-[collapsed]/side:hidden pointer-fine:opacity-0 pointer-fine:group-focus-within/folder:opacity-100 pointer-fine:group-hover/folder:opacity-100 pointer-fine:aria-expanded:opacity-100";

/**
 * The `⋯` menu of a folder row. Moving, also into a section, is here too, so the order can be changed without
 * dragging.
 */
export function FolderActions({
    name,
    color,
    canMoveUp,
    canMoveDown,
    sections,
    section,
    onNew,
    onRunItem,
    onRename,
    onColor,
    onMove,
    onSection,
    onNewSection,
}: {
    name: string;
    color: FolderColor | undefined;
    canMoveUp: boolean;
    canMoveDown: boolean;
    /** Every section, top down. */
    sections: { id: string; name: string }[];
    /** The one this folder is in. */
    section: string | undefined;
    onNew: () => void;
    /** Runs an extension's item; undefined leaves them out, for a folder no session works in. */
    onRunItem: ((item: FolderFolderMenuItem) => void) | undefined;
    onRename: () => void;
    onColor: (color: FolderColor | undefined) => void;
    onMove: (by: -1 | 1) => void;
    /** Undefined takes the folder out of every section. */
    onSection: (section: string | undefined) => void;
    onNewSection: () => void;
}) {
    // The field takes the caret only once the menu is gone: a menu still fading takes the keyboard back.
    const whenClosed = useRef<(() => void) | null>(null);
    const items = useFolderMenu();

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${name}`}
                    className={MENU_TRIGGER}
                >
                    <MoreHorizontal className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                    const then = whenClosed.current;

                    if (then !== null) {
                        event.preventDefault();
                        whenClosed.current = null;
                        then();
                    }
                }}
            >
                <DropdownMenuItem onSelect={onNew}>
                    <Plus className="size-4" />
                    New session
                </DropdownMenuItem>
                {onRunItem === undefined
                    ? null
                    : items.map((item) => (
                          <DropdownMenuItem
                              key={`${item.folder}:${item.id}`}
                              onSelect={() => {
                                  onRunItem(item);
                              }}
                          >
                              {item.icon}
                              {item.label}
                          </DropdownMenuItem>
                      ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => {
                        whenClosed.current = onRename;
                    }}
                >
                    <Pencil className="size-4" />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Colour</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        {FOLDER_COLORS.map((hue) => (
                            <DropdownMenuItem
                                key={hue}
                                onSelect={() => {
                                    onColor(hue);
                                }}
                            >
                                <span className={`size-2 shrink-0 ${FOLDER_DOT[hue]}`} />
                                <span className="flex-1 capitalize">{hue}</span>
                                {hue === color ? <Check className="size-4" /> : null}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                onColor(undefined);
                            }}
                        >
                            Default
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Section</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem
                            onSelect={() => {
                                onSection(undefined);
                            }}
                        >
                            <span className="flex-1">None</span>
                            {section === undefined ? <Check className="size-4" /> : null}
                        </DropdownMenuItem>
                        {sections.map((entry) => (
                            <DropdownMenuItem
                                key={entry.id}
                                onSelect={() => {
                                    onSection(entry.id);
                                }}
                            >
                                <span className="flex-1 truncate">{entry.name}</span>
                                {entry.id === section ? <Check className="size-4" /> : null}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                whenClosed.current = onNewSection;
                            }}
                        >
                            <Plus className="size-4" />
                            New section
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={!canMoveUp}
                    onSelect={() => {
                        onMove(-1);
                    }}
                >
                    <ArrowUp className="size-4" />
                    Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={!canMoveDown}
                    onSelect={() => {
                        onMove(1);
                    }}
                >
                    <ArrowDown className="size-4" />
                    Move down
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
