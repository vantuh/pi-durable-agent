import { Skeleton } from "@/components/ui/skeleton";

/**
 * Where the first turn will land: the shape of a question and an answer, pulsing in a wave. An empty screen that shows
 * this is a conversation on its way, not a conversation with nothing in it.
 */
export function LoadingTurn() {
    return (
        <div aria-hidden className="flex flex-col gap-5">
            <Skeleton className="ml-auto h-9 w-1/3" />
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Skeleton className="size-3 [animation-delay:120ms]" />
                    <Skeleton className="h-2.5 w-28 [animation-delay:120ms]" />
                </div>
                <Skeleton className="h-3 w-full [animation-delay:120ms]" />
                <Skeleton className="h-3 w-11/12 [animation-delay:240ms]" />
                <Skeleton className="h-3 w-3/4 [animation-delay:240ms]" />
            </div>
            <Skeleton className="h-7 w-1/2 [animation-delay:360ms]" />
            <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-full [animation-delay:480ms]" />
                <Skeleton className="h-3 w-5/6 [animation-delay:480ms]" />
            </div>
        </div>
    );
}
