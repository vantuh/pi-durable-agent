import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";

export type Shot = { src: string | undefined; name: string };

function StepButton({
    side,
    disabled,
    onClick,
}: {
    side: "previous" | "next";
    disabled: boolean;
    onClick: () => void;
}) {
    const Icon = side === "previous" ? ChevronLeft : ChevronRight;
    const label = side === "previous" ? "Previous photo" : "Next photo";

    return (
        <Hint label={label}>
            <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) {
                        onClick();
                    }
                }}
                className={`bg-sunken/30 focus-visible:bg-sunken/60 focus-visible:text-ink aria-disabled:bg-sunken/30 aria-disabled:text-muted hover:bg-sunken/60 absolute top-1/2 size-8 -translate-y-1/2 opacity-70 hover:opacity-100 focus-visible:opacity-100 aria-disabled:cursor-default aria-disabled:opacity-30 ${side === "previous" ? "left-1.5" : "right-1.5"}`}
            >
                <Icon className="size-5" />
            </Button>
        </Hint>
    );
}

/**
 * One picture, as big as the screen allows: the wheel or a pinch zooms it, a drag moves it, and a
 * double click or tap puts it back whole. With several, arrows and ArrowLeft/ArrowRight step between
 * them, without wrapping.
 */
export function Lightbox({
    shots,
    index,
    onIndex,
    onClose,
}: {
    shots: Shot[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
}) {
    const content = useRef<HTMLDivElement>(null);
    const shot = shots[index];
    const many = shots.length > 1;

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const next = index + step;

        if (many && step !== 0) {
            event.preventDefault();
            event.currentTarget.focus();

            if (next >= 0 && next < shots.length) {
                onIndex(next);
            }
        }
    }

    if (shot === undefined) {
        return null;
    }

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                ref={content}
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    content.current?.focus();
                }}
                onKeyDown={onKeyDown}
                className="bg-panel border-edge gap-1.5 p-1.5 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[calc(100vw-2rem)] sm:max-w-6xl"
            >
                <DialogTitle className="sr-only">{shot.name}</DialogTitle>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {/* The space a picture does not fill is a way out of the viewer, and on a phone it is most of it. */}
                    <button
                        type="button"
                        aria-label="Close preview"
                        onClick={onClose}
                        className="focus-visible:ring-accent absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    />
                    {/* A new picture starts whole: the wrapper is keyed by it. */}
                    <TransformWrapper
                        key={shot.src}
                        minScale={1}
                        maxScale={8}
                        wheel={{ step: 0.002 }}
                        doubleClick={{ mode: "reset" }}
                        panning={{ velocityDisabled: true }}
                        keyboard={{ disabled: true }}
                    >
                        <TransformComponent
                            wrapperStyle={{
                                width: "100%",
                                height: "100%",
                                touchAction: "none",
                                pointerEvents: "none",
                            }}
                            contentStyle={{ width: "100%", height: "100%" }}
                            contentClass="items-center justify-center"
                        >
                            {/* Inline, because the library's own stylesheet turns images transparent to the pointer, and
                                this one has to take it: the blank space under it is the way out of the viewer. */}
                            <img
                                src={shot.src}
                                alt={shot.name}
                                style={{ pointerEvents: "auto" }}
                                className="block max-h-full max-w-full object-contain"
                            />
                        </TransformComponent>
                    </TransformWrapper>
                    {many ? (
                        <>
                            <StepButton
                                side="previous"
                                disabled={index === 0}
                                onClick={() => {
                                    onIndex(index - 1);
                                }}
                            />
                            <StepButton
                                side="next"
                                disabled={index === shots.length - 1}
                                onClick={() => {
                                    onIndex(index + 1);
                                }}
                            />
                        </>
                    ) : null}
                </div>
                <div className="text-meta text-muted flex min-w-0 items-center gap-3 px-1">
                    <p className="min-w-0 flex-1 truncate font-mono">{shot.name}</p>
                    {many ? (
                        <p className="shrink-0 tabular-nums" aria-live="polite">
                            {index + 1} / {shots.length}
                        </p>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
