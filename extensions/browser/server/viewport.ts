/** Page sizes for the built-in browser: the presets people pick and Pi names, and sizes read from either. */
import type { Viewport } from "../refs.ts";

export type ViewportPreset = "mobile" | "tablet" | "desktop";

/** A page's size in CSS pixels, its device pixel ratio, and whether it acts as a phone or tablet (touch, mobile layout). */
export type { Viewport };

const isPreset = (name: string): name is ViewportPreset => Object.hasOwn(VIEWPORTS, name);

export const VIEWPORTS: Readonly<Record<ViewportPreset, Viewport>> = {
    mobile: { width: 390, height: 844, scale: 2, mobile: true },
    tablet: { width: 820, height: 1180, scale: 2, mobile: true },
    desktop: { width: 1280, height: 800, scale: 1, mobile: false },
};

export const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

/** A preset name, `WIDTHxHEIGHT`, or a viewport object, as a viewport; undefined when it is none of these. */
export function viewportFrom(value: unknown): Viewport | undefined {
    if (typeof value === "string") {
        const name = value.trim().toLowerCase();

        if (isPreset(name)) {
            return { ...VIEWPORTS[name] };
        }

        const match = /^(\d{3,4})\s*[x×]\s*(\d{3,4})$/.exec(name);

        if (match === null) {
            return undefined;
        }

        const width = clamp(Number(match[1]), 240, 3840);

        return { width, height: clamp(Number(match[2]), 240, 3840), scale: 1, mobile: width < 600 };
    }

    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const raw = (key: string): unknown => Reflect.get(value, key);
    const width = raw("width");
    const height = raw("height");

    if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
    ) {
        return undefined;
    }

    const scale = raw("scale");

    return {
        width: clamp(Math.round(width), 240, 3840),
        height: clamp(Math.round(height), 240, 3840),
        scale: typeof scale === "number" && Number.isFinite(scale) ? clamp(scale, 1, 3) : 1,
        mobile: raw("mobile") === true,
    };
}

/** The preset a viewport is, if it is one. */
export function presetOf(viewport: Viewport): ViewportPreset | undefined {
    return Object.keys(VIEWPORTS)
        .filter(isPreset)
        .find((name) => {
            const preset = VIEWPORTS[name];

            return (
                preset.width === viewport.width &&
                preset.height === viewport.height &&
                preset.mobile === viewport.mobile
            );
        });
}
