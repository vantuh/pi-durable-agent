import {
    type PointerEvent,
    type UIEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    type WheelEvent,
} from "react";

import type { ClientEntry } from "../../../shared/protocol.ts";

/** Two screens from the top the older page is asked for, so a flick upward does not reach the top before it lands. */
const olderAt = (el: HTMLElement): number => el.clientHeight * 2;

/**
 * Safari before 27 does not hold the reader's place itself. A touch fling waits on every browser: iOS keeps the place
 * of neither its own anchoring nor a scrollTop written while the fling runs, whatever `CSS.supports` says.
 */
const ANCHORS = CSS.supports("overflow-anchor", "auto");

/** No scroll event for this long, and no finger down: the fling is over. */
const SETTLED_MS = 150;

export function useTranscriptScroll(
    entries: ClientEntry[],
    exhausted: boolean,
    onLoadOlder: (settled: () => Promise<void>) => Promise<void>,
) {
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const lastTop = useRef(0);
    /** The height and position before the last commit: a page added in front must not move what is read. */
    const measured = useRef<{ first: number | undefined; height: number; top: number } | null>(
        null,
    );
    const newest = entries.at(-1);
    // Only the person's own message pulls the reader down; an agent's report waits where it lands.
    const sent = newest?.kind === "user" && newest.author === undefined;
    const counted = useRef(entries.length);
    const first = entries[0]?.id;
    /** The first entry an automatic ask was made for: a page that arrives moves it, an answer that never came does not. */
    const autoAsked = useRef<number | undefined>(undefined);
    const touching = useRef(false);
    const moving = useRef(false);
    const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const waiting = useRef<(() => void)[]>([]);

    const settled = useCallback(
        () =>
            !moving.current
                ? Promise.resolve()
                : new Promise<void>((done) => {
                      waiting.current.push(done);
                  }),
        [],
    );

    const stir = useCallback(() => {
        moving.current = true;
        clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
            if (touching.current) {
                return;
            }

            moving.current = false;

            for (const done of waiting.current.splice(0)) {
                done();
            }
        }, SETTLED_MS);
    }, []);

    useLayoutEffect(() => {
        const target = scroller.current;
        const previous = measured.current;

        // A message just sent: go down to it from wherever the reader was.
        if (sent && entries.length > counted.current) {
            following.current = true;
        }

        counted.current = entries.length;

        if (target === null) {
            return;
        }

        const height = target.scrollHeight;
        const top = target.scrollTop;
        const prepended =
            previous !== null && previous.first !== undefined && previous.first !== first;

        if (prepended) {
            // An older page arrived above: keep the words the reader was looking at where they were. Chrome and
            // Firefox already did it unless the reader was at the very top; Safari before 27 never does. Writing
            // scrollTop again would undo the reader's last unreported step and stop a flick.
            const grown = height - previous.height;
            const anchored = Math.abs(top - previous.top - grown) < Math.abs(top - previous.top);

            if (!anchored) {
                target.scrollTop = top + grown;
            }
        } else if (following.current) {
            target.scrollTop = target.scrollHeight;
        }

        measured.current = { first, height, top: target.scrollTop };

        // A tail too short to scroll fires no scroll event, so a compaction's short view would never ask for what it
        // set aside. Once per first entry: a failed answer must not be asked for again by the commit it caused.
        if (!exhausted && target.scrollTop < olderAt(target) && autoAsked.current !== first) {
            autoAsked.current = first;
            void onLoadOlder(settled);
        }
    });

    // Rows that grow between renders (code highlighting, images) keep the bottom in view while following.
    useEffect(() => {
        const target = scroller.current;
        const inner = content.current;

        if (target === null || inner === null) {
            return undefined;
        }

        const sizes = new ResizeObserver(() => {
            if (following.current) {
                target.scrollTop = target.scrollHeight;
            }

            if (measured.current !== null) {
                measured.current = { ...measured.current, height: target.scrollHeight };
            }
        });

        sizes.observe(inner);

        return () => {
            sizes.disconnect();
        };
    }, []);

    return {
        scroller,
        content,
        scrolling: {
            // Leaving is decided by what the reader does, not by where the scroll lands: a chunk of
            // text arriving before the scroll event must not pull them back down.
            onWheel: (event: WheelEvent<HTMLDivElement>) => {
                if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) {
                    following.current = false;
                }
            },
            onTouchStart: () => {
                touching.current = true;
                stir();
            },
            onTouchMove: () => {
                following.current = false;
            },
            onTouchEnd: () => {
                touching.current = false;
                stir();
            },
            onTouchCancel: () => {
                touching.current = false;
                stir();
            },
            onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
                // A fold the reader opens while pinned to the bottom would grow upward, out of
                // what they are looking at: they have left the bottom to read it.
                if (
                    event.target === event.currentTarget ||
                    (event.target instanceof Element &&
                        event.target.closest("[data-slot='collapsible-trigger']") !== null)
                ) {
                    following.current = false;
                }
            },
            onScroll: (event: UIEvent<HTMLDivElement>) => {
                const el = event.currentTarget;
                const gap = el.scrollHeight - el.scrollTop - el.clientHeight;

                // Any move up is the reader leaving; only getting back to the bottom follows again.
                if (el.scrollTop < lastTop.current) {
                    following.current = false;
                } else if (gap < 24) {
                    following.current = true;
                }

                lastTop.current = el.scrollTop;

                // The reader keeps scrolling while a page loads: the page must land against where they are now.
                if (measured.current !== null) {
                    measured.current = {
                        ...measured.current,
                        height: el.scrollHeight,
                        top: el.scrollTop,
                    };
                }

                // A wheel or trackpad only waits where the browser cannot anchor; a touch already set `moving`.
                if (!ANCHORS || moving.current) {
                    stir();
                }

                if (el.scrollTop < olderAt(el) && !exhausted) {
                    void onLoadOlder(settled);
                }
            },
        },
    };
}
