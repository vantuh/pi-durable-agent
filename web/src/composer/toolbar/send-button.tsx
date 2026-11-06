import { ArrowUp, ChevronDown } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";

import type { SendMode } from "../../../../shared/protocol.ts";
import { MODES, type ModeOption } from "./send-modes.ts";

/** Send, and while a run is going, the choice of how: steer, queue or interrupt. */
export function SendButton({
    busy,
    how,
    mode,
    disabled,
    field,
    onModeChange,
    onSend,
}: {
    busy: boolean;
    /** The chosen mode, which names the button while a run is going. */
    how: ModeOption | undefined;
    mode: SendMode;
    disabled: boolean;
    field: RefObject<HTMLTextAreaElement | null>;
    onModeChange: (mode: SendMode) => void;
    onSend: () => void;
}) {
    return (
        <div className="flex items-center">
            <Hint label={busy ? (how?.label ?? "Send") : "Send"} keys={<Kbd>Enter</Kbd>}>
                <Button
                    size={busy ? "default" : "icon"}
                    aria-label={busy ? (how?.label ?? "Send") : "Send"}
                    onClick={onSend}
                    // Keep focus in the textarea so the phone keyboard stays put and the tap is not lost.
                    onMouseDown={(event) => {
                        event.preventDefault();
                    }}
                    className={`relative gap-1 before:absolute before:-inset-2 before:content-[''] disabled:opacity-40 ${
                        busy ? "h-7 w-auto pr-1.5 pl-2" : ""
                    }`}
                    disabled={disabled}
                >
                    <ArrowUp className="size-4" />
                    {busy ? <span>{how?.label}</span> : null}
                </Button>
            </Hint>
            {busy ? (
                <DropdownMenu>
                    <Hint label="How to send">
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon"
                                aria-label="How to send"
                                className="border-on-accent/30 w-6 border-l"
                            >
                                <ChevronDown className="size-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                    </Hint>
                    <DropdownMenuContent
                        side="top"
                        align="end"
                        sideOffset={6}
                        className="w-64"
                        // The mode belongs to the message being typed: the caret goes back where it was.
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            field.current?.focus({ preventScroll: true });
                        }}
                    >
                        <DropdownMenuRadioGroup
                            value={mode}
                            onValueChange={(value) => {
                                const chosen = MODES.find((option) => option.mode === value);

                                if (chosen !== undefined) {
                                    onModeChange(chosen.mode);
                                }
                            }}
                        >
                            {MODES.map((option) => (
                                <DropdownMenuRadioItem key={option.mode} value={option.mode}>
                                    <span className="flex flex-col">
                                        <span className="text-interface text-ink">
                                            {option.label}
                                        </span>
                                        <span className="text-meta text-faint">{option.hint}</span>
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}
