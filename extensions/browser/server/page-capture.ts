import type { Send } from "./send.ts";
import type { Viewport } from "./viewport.ts";

/**
 * The longest side of a screenshot's image, in pixels. Models refuse larger images once a conversation holds many of
 * them, and that refusal breaks every turn after it; they shrink anything past about 1600 pixels themselves anyway.
 */
export const SHOT_MAX = 2000;

/** The scale that brings an image of `width` × `height` pixels within `SHOT_MAX`. */
const fit = (width: number, height: number) => Math.min(1, SHOT_MAX / Math.max(width, height, 1));

/**
 * A JPEG of the viewport, or of the whole page (up to 8000 CSS pixels tall). The size it reports is in CSS pixels;
 * the image itself is at most `SHOT_MAX` pixels on its longer side, `scale` image pixels to a CSS pixel (1 unless
 * that made it smaller).
 */
export async function captureScreenshot(
    send: Send,
    viewport: Viewport,
    options: { fullPage?: boolean } = {},
): Promise<{ data: string; width: number; height: number; scale: number }> {
    const scale = 1 / viewport.scale;

    if (options.fullPage === true) {
        const metrics = await send("Page.getLayoutMetrics");
        const size = metrics.cssContentSize ?? metrics.contentSize;
        const width = Math.ceil(size.width);
        const height = Math.min(Math.ceil(size.height), 8000);
        const shot = await send(
            "Page.captureScreenshot",
            {
                format: "jpeg",
                quality: 80,
                captureBeyondViewport: true,
                clip: { x: 0, y: 0, width, height, scale: scale * fit(width, height) },
            },
            60_000,
        );

        return { data: String(shot.data), width, height, scale: fit(width, height) };
    }

    const metrics = await send("Page.getLayoutMetrics");
    const view = metrics.cssVisualViewport ?? {
        pageX: 0,
        pageY: 0,
        clientWidth: viewport.width,
        clientHeight: viewport.height,
        scale: 1,
    };
    const zoom = view.scale ?? 1;
    const shot = await send(
        "Page.captureScreenshot",
        {
            format: "jpeg",
            quality: 80,
            clip: {
                x: view.pageX,
                y: view.pageY,
                width: view.clientWidth,
                height: view.clientHeight,
                scale: scale * zoom * fit(view.clientWidth, view.clientHeight),
            },
        },
        60_000,
    );

    return {
        data: String(shot.data),
        width: viewport.width,
        height: viewport.height,
        scale: fit(view.clientWidth, view.clientHeight),
    };
}
