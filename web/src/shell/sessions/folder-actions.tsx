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

import { FOLDER_COLORS, type FolderColor } from "../../../../shared/folders.ts";
import { FOLDER_DOT } from "./folder-tones.ts";

/** The `⋯` menu of a folder row. Moving is also here, so the order can be changed without dragging. */
export function FolderActions({
    name,
    color,
    canMoveUp,
    canMoveDown,
    onNew,
    onRename,
    onColor,
    onMove,
}: {
    name: string;
    color: FolderColor | undefined;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onNew: () => void;
    onRename: () => void;
    onColor: (color: FolderColor | undefined) => void;
    onMove: (by: -1 | 1) => void;
}) {
    // The field takes the caret only once the menu is gone: a menu still fading takes the keyboard back.
    const renameWhenClosed = useRef(false);

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${name}`}
                    // A mouse shows it on hover; a finger has no hover, so it is always there.
                    className="shrink-0 lg:group-data-[collapsed]/side:hidden pointer-fine:opacity-0 pointer-fine:group-focus-within/folder:opacity-100 pointer-fine:group-hover/folder:opacity-100 pointer-fine:aria-expanded:opacity-100"
                >
                    <MoreHorizontal className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                    if (renameWhenClosed.current) {
                        event.preventDefault();
                        renameWhenClosed.current = false;
                        onRename();
                    }
                }}
            >
                <DropdownMenuItem onSelect={onNew}>
                    <Plus className="size-4" />
                    New session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => {
                        renameWhenClosed.current = true;
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
