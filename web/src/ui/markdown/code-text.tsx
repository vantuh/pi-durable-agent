import type { ThemedToken } from "@pierre/highlights";
import { Fragment, useEffect, useRef, useState } from "react";

import { classOf, tokensOf } from "@/lib/highlight.ts";

type Highlighted = { code: string; lines: ThemedToken[][] };

/** How long a block that is still arriving waits for its text to pause before it is highlighted again. */
const HIGHLIGHT_DELAY_MS = 150;

/** Highlighted text without a frame, with the same streaming behavior as a fenced code block. */
export function CodeText({
    code,
    lang,
    highlight = tokensOf,
    lineClassName,
}: {
    code: string;
    lang: string;
    highlight?: typeof tokensOf;
    lineClassName?: ((row: number) => string | undefined) | undefined;
}) {
    const [shown, setShown] = useState<Highlighted | undefined>(undefined);
    /** A block that arrived whole is highlighted at once; one whose text is still coming waits for it to pause. */
    const first = useRef(true);

    useEffect(() => {
        let current = true;

        if (lang === "") {
            return undefined;
        }

        const update = async () => {
            try {
                const lines = await highlight(code, lang);

                if (current && lines !== undefined) {
                    setShown({ code, lines });
                }
            } catch {
                // A grammar that fails to load leaves the code plain.
            }
        };

        // Highlights' tokens are the whole block, so re-highlighting one that is still arriving would redo all of it for
        // every 100 ms chunk: it waits for the text to stop instead, and the new text shows plain meanwhile.
        const timer = setTimeout(
            () => {
                void update();
            },
            first.current ? 0 : HIGHLIGHT_DELAY_MS,
        );

        first.current = false;

        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [code, lang, highlight]);

    const fresh = shown !== undefined && code.startsWith(shown.code) ? shown : undefined;

    return (
        <>
            {fresh === undefined
                ? code
                : fresh.lines.map((line, row) => (
                      // oxlint-disable-next-line react/no-array-index-key -- lines of one code have no id; their order is the identity
                      <Fragment key={row}>
                          <span className={lineClassName?.(row)}>
                              {line.map((token, at) => (
                                  // oxlint-disable-next-line react/no-array-index-key -- tokens of one line, likewise
                                  <span key={at} className={classOf(token)}>
                                      {token.content}
                                  </span>
                              ))}
                          </span>
                          {row < fresh.lines.length - 1 ? "\n" : null}
                      </Fragment>
                  ))}
            {fresh === undefined ? null : code.slice(fresh.code.length)}
        </>
    );
}
