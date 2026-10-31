const FENCE = /^ *(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?: |$)/;

type Fence = { mark: string; length: number };

function opening(line: string): Fence | undefined {
    const match = FENCE.exec(line);
    const run = match?.[1];

    // An info string after a backtick fence cannot hold a backtick: "```a```" is inline code.
    if (run === undefined || (run.startsWith("`") && (match?.[2] ?? "").includes("`"))) {
        return undefined;
    }

    return { mark: run.charAt(0), length: run.length };
}

function closes(line: string, fence: Fence): boolean {
    const run = FENCE.exec(line)?.[1];

    return (
        run !== undefined &&
        run.startsWith(fence.mark) &&
        run.length >= fence.length &&
        line.trim() === run
    );
}

/**
 * Cuts a growing reply where its finished part stops changing: before the last line at column 0 that
 * follows a blank line outside any code fence and cannot continue a list or a quote. `stable + tail` is
 * always `text`, so the part before the cut is parsed once and only the tail again on every frame.
 */
export function splitStable(text: string): { stable: string; tail: string } {
    let fence: Fence | undefined;
    let offset = 0;
    let cut = 0;
    let blank = false;

    for (const line of text.split("\n")) {
        if (fence !== undefined) {
            fence = closes(line, fence) ? undefined : fence;
            blank = false;
        } else {
            if (blank && line !== "" && !/^[ \t>]/.test(line) && !LIST_ITEM.test(line)) {
                cut = offset;
            }

            fence = opening(line);
            blank = line.trim() === "";
        }

        offset += line.length + 1;
    }

    return { stable: text.slice(0, cut), tail: text.slice(cut) };
}
