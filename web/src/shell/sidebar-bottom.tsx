import {
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";

import { useSidebarBottomItems } from "../extensions.ts";
import { areaLimits, clampArea, heightForKey, NARROW, WIDE } from "../lib/sidebar-bottom.ts";
import type { SidebarBottomProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

const HEIGHT_KEY = "sidebarBottomHeight";
/** The sidebar's `lg:` breakpoint. */
const WIDE_QUERY = "(min-width: 1024px)";

function savedHeight(): number | null {
    const height = Number(localStorage.getItem(HEIGHT_KEY));

    return height > 0 ? height : null;
}

/**
 * What extensions put under the session list, and the handle that sets its height. The block is
 * hidden whole, handle included, while no item renders anything. Without a saved height it fits
 * its content, up to a few rows.
 */
export function SidebarBottom({
    list,
    ...props
}: SidebarBottomProps & { list: RefObject<HTMLElement | null> }) {
    const items = useSidebarBottomItems();
    const root = useRef<HTMLDivElement>(null);
    const area = useRef<HTMLDivElement>(null);
    const drag = useRef<{ y: number; height: number } | null>(null);
    const [saved, setSaved] = useState(savedHeight);
    const [shared, setShared] = useState(0);
    const [wide, setWide] = useState(true);
    const [height, setHeight] = useState(0);
    const metrics = wide ? WIDE : NARROW;
    const limits = areaLimits(shared, metrics);
    const fixed = saved === null ? null : clampArea(saved, limits);
    const atLimit = height <= limits.min || height >= limits.max;

    useEffect(() => {
        const box = area.current;
        const above = list.current;

        if (box === null || above === null) {
            return undefined;
        }

        const measure = (): void => {
            // The list and the area split what the sidebar has left; a hidden block takes none of it.
            setShared(above.clientHeight + (root.current?.offsetHeight ?? 0));
            setWide(matchMedia(WIDE_QUERY).matches);
            setHeight(box.offsetHeight);
        };
        const observer = new ResizeObserver(measure);

        observer.observe(above);
        observer.observe(box);
        measure();

        return () => {
            observer.disconnect();
        };
    }, [list]);

    const change = (next: number, save: boolean): void => {
        setSaved(next);

        if (save) {
            localStorage.setItem(HEIGHT_KEY, String(next));
        }
    };
    const reset = (): void => {
        localStorage.removeItem(HEIGHT_KEY);
        setSaved(null);
    };
    const end = (): void => {
        if (drag.current === null) {
            return;
        }

        drag.current = null;
        document.documentElement.classList.remove("resizing-y");

        if (area.current !== null) {
            localStorage.setItem(HEIGHT_KEY, String(area.current.offsetHeight));
        }
    };
    const press = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter") {
            event.preventDefault();
            reset();

            return;
        }

        const next = heightForKey(event.key, event.shiftKey, height, limits);

        if (next !== null) {
            event.preventDefault();
            change(next, true);
        }
    };
    const start = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height };
        document.documentElement.classList.add("resizing-y");
    };
    const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (drag.current !== null) {
            // The handle is above the area, so dragging up makes the area taller.
            change(clampArea(drag.current.height + drag.current.y - event.clientY, limits), false);
        }
    };

    return (
        <div
            ref={root}
            className="flex flex-none flex-col has-[[data-sidebar-bottom]:empty]:hidden lg:group-data-[collapsed]/side:hidden"
        >
            <div
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable splitter is the WAI-ARIA window splitter; `hr` takes neither focus nor handlers
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the area under the session list"
                aria-valuemin={limits.min}
                aria-valuemax={limits.max}
                aria-valuenow={height}
                aria-valuetext={`${String(height)} pixels`}
                tabIndex={0}
                title="Drag to resize, double-click to reset"
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
                onKeyDown={press}
                onDoubleClick={reset}
                className={`border-edge-soft bg-panel focus-visible:outline-accent relative h-4 flex-none cursor-row-resize touch-none border-t outline-none before:absolute before:inset-x-0 before:-inset-y-1.5 after:absolute after:top-1/2 after:left-1/2 after:h-[3px] after:w-8 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full focus-visible:outline-2 focus-visible:-outline-offset-2 lg:h-2.5 ${atLimit ? "after:bg-warn" : "after:bg-edge hover:after:bg-accent focus-visible:after:bg-accent [:root.resizing-y_&]:after:bg-accent"}`}
            />
            <div
                ref={area}
                style={
                    fixed === null
                        ? {
                              minHeight: limits.min,
                              maxHeight: Math.min(metrics.autoMax, limits.max),
                          }
                        : { height: fixed }
                }
                className="bg-panel flex flex-col overflow-y-auto"
            >
                <div data-sidebar-bottom="" className="flex min-h-0 flex-1 flex-col">
                    {items.map(({ folder, id, component: Item }) => (
                        <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                            <Item {...props} />
                        </ItemBoundary>
                    ))}
                </div>
            </div>
        </div>
    );
}
