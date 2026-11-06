import { diffCounts } from "./diff.ts";
import type { Step, ToolStep } from "./turns.ts";

const DID: Record<string, { verb: string; noun?: string; by?: string }> = {
    read: { verb: "read", noun: "file", by: "path" },
    edit: { verb: "edited", noun: "file", by: "path" },
    write: { verb: "wrote", noun: "file", by: "path" },
    bash: { verb: "ran", noun: "command" },
    grep: { verb: "searched" },
    find: { verb: "searched" },
    ls: { verb: "listed", noun: "folder", by: "path" },
};

export function argOf(args: unknown, key: string): string | undefined {
    if (typeof args !== "object" || args === null || !(key in args)) {
        return undefined;
    }

    const value: unknown = Reflect.get(args, key);

    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** The last segment of a path: what the person calls the file. */
function fileNameOf(path: string): string {
    return /(?:^|\/)([^/]*)$/.exec(path)?.[1] ?? path;
}

/** The skill a step loaded: Pi loads one by reading its `<name>/SKILL.md`. */
export function skillOf(step: Step): string | undefined {
    return step.kind === "tool" && step.name === "read"
        ? /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(argOf(step.args, "path") ?? "")?.[1]
        : undefined;
}

/** The one argument that says what a call was about: its path, command, or pattern. */
export function subjectOf(name: string, args: unknown): string | undefined {
    for (const key of ["path", "command", "pattern", "url", "query", "name"]) {
        const value = argOf(args, key);

        if (value !== undefined && value !== "") {
            return name === "bash" ? value.split("\n")[0] : value;
        }
    }

    return undefined;
}

const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length);

const plural = (count: number, noun: string): string =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** Lines an edit put in and took out, from its `edits` argument. */
function editCounts(args: unknown): { added: number; removed: number } | undefined {
    const edits: unknown =
        typeof args === "object" && args !== null ? Reflect.get(args, "edits") : undefined;

    if (!Array.isArray(edits)) {
        return undefined;
    }

    let added = 0;
    let removed = 0;

    for (const each of edits) {
        added += lineCount(argOf(each, "newText") ?? "");
        removed += lineCount(argOf(each, "oldText") ?? "");
    }

    return { added, removed };
}

/** Commands that run tests, by the words in them. */
const TESTS = /\b(?:test|tests|spec|jest|vitest|pytest|mocha|ava|tap|rspec|phpunit|ctest)\b/i;

/** A command that makes a commit: `commit` as git's own subcommand, not a word inside another argument. */
const COMMITS = /\bgit\b[^|;&\n]*\scommit\b/;

/**
 * A test run's outcome from what it printed, as in "48 passed · 1 failed · 3.1s": for a command that runs tests, or
 * output with a runner's own summary. After Pi Pocket's `testOutcome` (`web/turns.js`, MIT).
 */
export function testOutcome(
    text: string,
    command: string,
): { text: string; passed: number; failed: number } | undefined {
    if (!TESTS.test(command) && !/^(?:# pass|ℹ pass|Tests:) /m.test(text)) {
        return undefined;
    }

    // Node's own count first ("ℹ pass 48"), then Jest's and Vitest's line for tests ("Tests: 1 failed, 47 passed"),
    // then any "N passed" or "N passing".
    const count = (node: string, word: string): number | undefined => {
        const found =
            new RegExp(`^(?:#|ℹ) ${node} (\\d+)`, "m").exec(text)?.[1] ??
            new RegExp(`^\\s*Tests:?\\s+(?:[^\\n]*?\\D)?(\\d+) ${word}`, "m").exec(text)?.[1] ??
            new RegExp(
                `\\b(\\d+) (?:${word}|${word === "passed" ? "passing" : "failing"})\\b`,
            ).exec(text)?.[1];

        return found === undefined ? undefined : Number(found);
    };
    const passed = count("pass", "passed");

    if (passed === undefined) {
        return undefined;
    }

    const failed = count("fail", "failed") ?? 0;
    const ms = /duration_ms ([\d.]+)/.exec(text)?.[1];
    const seconds =
        ms === undefined
            ? Number(/\b(?:in|Duration|Time:)\s+([\d.]+)\s?s\b/.exec(text)?.[1] ?? Number.NaN)
            : Number(ms) / 1000;
    const parts = [
        `${String(passed)} passed`,
        ...(failed > 0 ? [`${String(failed)} failed`] : []),
        ...(Number.isFinite(seconds)
            ? [seconds < 10 ? `${seconds.toFixed(1)}s` : `${String(Math.round(seconds))}s`]
            : []),
    ];

    return { text: parts.join(" · "), passed, failed };
}

/** What a finished call came to, on the right of its line: "89 lines", "+3 −1", "no output". */
export function outcomeOf(
    step: ToolStep,
):
    | { text: string; tone?: "ok" | "danger"; counts?: { added: number; removed: number } }
    | undefined {
    const result = step.result;

    if (result === undefined) {
        return step.status === "stopped" ? { text: "did not run" } : undefined;
    }

    const text = result.text.trim();
    const tests =
        step.name === "bash" ? testOutcome(text, argOf(step.args, "command") ?? "") : undefined;

    // Before the error: a run whose tests failed exits non-zero, and its counts say more than its exit code.
    if (tests !== undefined) {
        return { text: tests.text, tone: tests.failed > 0 || result.isError ? "danger" : "ok" };
    }

    if (result.isError) {
        if (/\b(?:aborted|interrupted)\b/i.test(text)) {
            return { text: "stopped", tone: "danger" };
        }

        // Not the harness's own tags around its errors ("<harness>"), nor its "[error]".
        const first =
            text
                .split("\n")
                .map((line) => line.trim().replace(/^\[[\w -]+\]\s*/, ""))
                .find((line) => line !== "" && !/^<\/?[\w-]+>$/.test(line)) ?? "failed";

        return { text: first.length > 48 ? `${first.slice(0, 47)}…` : first, tone: "danger" };
    }

    if (result.images !== undefined) {
        return { text: plural(result.images.length, "image") };
    }

    // A cut output cannot be counted.
    const counted = result.truncated === true ? undefined : lineCount(text);

    switch (step.name) {
        case "edit": {
            const counts =
                result.diff === undefined ? editCounts(step.args) : diffCounts(result.diff);

            return counts === undefined
                ? undefined
                : {
                      text: `+${String(counts.added)} −${String(counts.removed)}`,
                      tone: "ok",
                      counts,
                  };
        }

        case "write": {
            const content = argOf(step.args, "content");

            return content === undefined
                ? undefined
                : { text: `+${String(lineCount(content))}`, tone: "ok" };
        }

        case "read":
        case "bash":
            return counted === undefined
                ? { text: "long output" }
                : { text: counted === 0 ? "no output" : plural(counted, "line") };

        case "grep":
            return /^No matches/.test(text)
                ? { text: "no matches" }
                : {
                      text:
                          counted === undefined
                              ? "many matches"
                              : plural(counted, "match").replace("matchs", "matches"),
                  };

        case "find":
        case "ls":
            return {
                text:
                    counted === undefined
                        ? "many"
                        : plural(counted, step.name === "ls" ? "entry" : "file").replace(
                              "entrys",
                              "entries",
                          ),
            };

        default:
            return undefined;
    }
}

/** A picture a group's calls returned: the entry that holds it, and where inside it. */
export type GroupImage = { entry: number; index: number; name: string };

/**
 * Every picture a group's calls returned, in the order they came: one call's, then the next call's. Its name is
 * the file it was read from — "read image 1" says nothing about which screenshot this is.
 */
export function imagesOf(steps: Step[]): GroupImage[] {
    return steps.flatMap((step) => {
        if (step.kind !== "tool" || step.result?.images === undefined) {
            return [];
        }

        const { id, images } = step.result;
        const path = argOf(step.args, "path");
        const file = path === undefined ? undefined : fileNameOf(path);
        const label = file ?? `${step.name} image`;

        return images.map((_image, index) => ({
            entry: id,
            index,
            // One picture is the file itself; several need telling apart.
            name:
                file !== undefined && images.length === 1 ? file : `${label} ${String(index + 1)}`,
        }));
    });
}

/** "Thought, read 2 files and ran 3 commands": each kind of step once, in the order Pi first did it. */
export function summarize(steps: Step[], thinking: boolean): string {
    const did = new Map<string, Map<string, Set<string>>>();

    for (const step of steps) {
        const kind =
            step.kind === "thinking"
                ? { verb: "thought" }
                : step.name === "bash" && COMMITS.test(argOf(step.args, "command") ?? "")
                  ? // The commit is a command, but a group that folded one should say so by itself.
                    { verb: "committed" }
                  : skillOf(step) !== undefined
                    ? { verb: "loaded", noun: "skill", by: "path" }
                    : (DID[step.name] ?? { verb: `used ${step.name}` });
        const nouns = did.get(kind.verb) ?? new Map<string, Set<string>>();

        did.set(kind.verb, nouns);

        if (step.kind === "tool" && kind.noun !== undefined) {
            const things = nouns.get(kind.noun) ?? new Set<string>();
            const by = kind.by === undefined ? undefined : argOf(step.args, kind.by);

            things.add(by ?? step.id);
            nouns.set(kind.noun, things);
        }
    }

    const parts = [...did].map(([verb, nouns]) => {
        const said = verb === "thought" && thinking && did.size === 1 ? "thinking" : verb;
        const counted = [...nouns].map(
            ([noun, things]) => `${String(things.size)} ${noun}${things.size === 1 ? "" : "s"}`,
        );

        return counted.length === 0 ? said : `${said} ${counted.join(", ")}`;
    });
    const last = parts.pop() ?? "";
    const line = parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;

    return line.charAt(0).toUpperCase() + line.slice(1);
}
