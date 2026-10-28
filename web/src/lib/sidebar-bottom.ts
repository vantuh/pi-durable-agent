/** Sizes in px. The area's minimum is a heading and two rows; the list's, a heading and three. */
export type AreaMetrics = {
    /** The area's smallest height. */
    min: number;
    /** The session list's smallest height. */
    listMin: number;
    /** The drag handle's height. */
    handle: number;
    /** The tallest the area grows by itself, before anyone resizes it. */
    autoMax: number;
};

/** From `lg` up: the sidebar is a column of the page. */
export const WIDE: AreaMetrics = { min: 96, listMin: 148, handle: 10, autoMax: 224 };
/** Below `lg`: the sidebar is a drawer and its rows are touch targets. */
export const NARROW: AreaMetrics = { min: 120, listMin: 160, handle: 16, autoMax: 296 };

export type AreaLimits = { min: number; max: number };

/** `shared` is the height the list and the area split between them, handle included. */
export function areaLimits(shared: number, metrics: AreaMetrics): AreaLimits {
    return {
        min: metrics.min,
        max: Math.max(metrics.min, Math.floor(shared - metrics.handle - metrics.listMin)),
    };
}

export function clampArea(wanted: number, limits: AreaLimits): number {
    return Math.round(Math.min(limits.max, Math.max(limits.min, wanted)));
}

const STEP = 16;
const BIG_STEP = 64;

/** The area's new height for a key pressed on the handle, or null for a key it does not take. */
export function heightForKey(
    key: string,
    shift: boolean,
    current: number,
    limits: AreaLimits,
): number | null {
    const step = shift ? BIG_STEP : STEP;

    // The handle is above the area, so Up makes the area taller.
    if (key === "ArrowUp") {
        return clampArea(current + step, limits);
    }

    if (key === "ArrowDown") {
        return clampArea(current - step, limits);
    }

    if (key === "Home") {
        return limits.min;
    }

    return key === "End" ? limits.max : null;
}
