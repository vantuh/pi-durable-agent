import { tokensOf } from "@/lib/highlight.ts";

import { embedded } from "./embedded.ts";

/** Keep Bash tokens outside interpreter code, and replace only the colours inside its source ranges. */
export async function commandTokens(source: string) {
    const [lines, scripts] = await Promise.all([
        tokensOf(source, "bash"),
        Promise.all(
            embedded(source).map(async (script) => {
                const tokens = await tokensOf(source.slice(script.pos, script.end), script.lang);

                return (tokens ?? [])
                    .flat()
                    .map((token) => ({ ...token, offset: script.pos + token.offset }));
            }),
        ),
    ]);
    const overlays = scripts.flat().sort((a, b) => a.offset - b.offset);
    let index = 0;

    return lines?.map((line) =>
        line.flatMap((token) => {
            const pieces: typeof line = [];
            const end = token.offset + token.content.length;
            let pos = token.offset;

            while (pos < end) {
                let overlay = overlays[index];

                while (overlay !== undefined && overlay.offset + overlay.content.length <= pos) {
                    index += 1;
                    overlay = overlays[index];
                }

                const active = overlay !== undefined && overlay.offset <= pos ? overlay : undefined;
                const next = Math.min(
                    end,
                    active !== undefined
                        ? active.offset + active.content.length
                        : (overlay?.offset ?? end),
                );

                pieces.push({
                    ...(active ?? token),
                    offset: pos,
                    content: source.slice(pos, next),
                });
                pos = next;
            }

            return pieces;
        }),
    );
}
