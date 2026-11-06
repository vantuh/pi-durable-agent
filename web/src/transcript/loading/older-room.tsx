import { LoadingTurn } from "./loading-turn.tsx";

/**
 * The room above the oldest loaded turn while more history exists: a flick upward runs into it instead of stopping
 * dead at the top, and the page that lands goes in below it. Never the browser's scroll anchor: the turns are what
 * must hold still.
 */
export function OlderRoom() {
    return (
        <div
            aria-hidden
            className="flex min-h-[60svh] flex-col justify-end gap-5 [mask-image:linear-gradient(to_bottom,transparent,black_70%)] [overflow-anchor:none]"
        >
            <LoadingTurn />
            <LoadingTurn />
        </div>
    );
}
