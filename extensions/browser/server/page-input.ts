import { KEYS, keyEvents } from "./keys.ts";
import type { Send } from "./send.ts";
import { clamp, type Viewport } from "./viewport.ts";

/**
 * Taps, drags, scrolls, and keys from the Browser panel, in order: `click`, `mouse` (down, up, or move), `wheel`, `key`,
 * and `text`, at CSS pixels of the viewport. They come from browsers, so each is checked as it is read.
 */
export async function dispatchInput(
    send: Send,
    viewport: Viewport,
    events: readonly unknown[],
): Promise<void> {
    const { width, height } = viewport;
    const point = (raw: object) => ({
        x: clamp(Number(Reflect.get(raw, "x")) || 0, 0, width),
        y: clamp(Number(Reflect.get(raw, "y")) || 0, 0, height),
    });
    const button = (raw: unknown) => (raw === "right" || raw === "middle" ? raw : "left");

    for (const item of events) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const field = (name: string): unknown => Reflect.get(item, name);

        switch (field("type")) {
            case "click":
                await clickAt(
                    send,
                    point(item),
                    button(field("button")),
                    clamp(Number(field("count")) || 1, 1, 3),
                );
                break;

            case "mouse": {
                const at = point(item);
                const pressed = button(field("button"));
                const type =
                    field("action") === "down"
                        ? "mousePressed"
                        : field("action") === "up"
                          ? "mouseReleased"
                          : "mouseMoved";
                const count = clamp(Number(field("count")) || 1, 1, 3);

                await send("Input.dispatchMouseEvent", {
                    type,
                    ...at,
                    button: type === "mouseMoved" && field("pressed") !== true ? "none" : pressed,
                    buttons: field("pressed") === true || type === "mousePressed" ? 1 : 0,
                    clickCount: type === "mouseMoved" ? 0 : count,
                });
                break;
            }

            case "wheel":
                await send("Input.dispatchMouseEvent", {
                    type: "mouseWheel",
                    ...point(item),
                    deltaX: clamp(Number(field("dx")) || 0, -5000, 5000),
                    deltaY: clamp(Number(field("dy")) || 0, -5000, 5000),
                });
                break;

            case "key": {
                const raw = field("key");
                const key = typeof raw === "string" ? raw : "";

                if (key === "" || key === "Unidentified" || key === "Dead" || key === "Process") {
                    break;
                }

                if (key.length !== 1 && KEYS[key] === undefined) {
                    break;
                }

                await pressKey(send, key, clamp(Number(field("modifiers")) || 0, 0, 15));
                break;
            }

            case "text": {
                const raw = field("text");
                const text = typeof raw === "string" ? raw.slice(0, 10_000) : "";

                if (text !== "") {
                    await send("Input.insertText", { text });
                }

                break;
            }
        }
    }
}

/** Moves to a point, then presses and releases `button` there `count` times. */
export async function clickAt(
    send: Send,
    at: { x: number; y: number },
    button: string,
    count: number,
): Promise<void> {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, button: "none" });

    for (let index = 1; index <= count; index++) {
        await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            ...at,
            button,
            buttons: 1,
            clickCount: index,
        });
        await send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            ...at,
            button,
            buttons: 0,
            clickCount: index,
        });
    }
}

/** Presses and releases one key with the given modifiers. */
export async function pressKey(send: Send, key: string, modifiers: number): Promise<void> {
    const { down, up } = keyEvents(key, modifiers);

    await send("Input.dispatchKeyEvent", down);
    await send("Input.dispatchKeyEvent", up);
}
