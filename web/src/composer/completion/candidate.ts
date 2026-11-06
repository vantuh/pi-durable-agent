import type { SkillInfo } from "@/lib/api.ts";
import { fuzzyScore } from "@/lib/fuzzy.ts";

/** What the composer runs itself instead of saying something; the same names `submit` matches on. */
const COMMANDS: { name: string; description: string; takesArgs: boolean }[] = [
    { name: "new", description: "Open a new session in this folder", takesArgs: false },
    { name: "model", description: "Choose the model for this session", takesArgs: false },
    { name: "compact", description: "Summarize the earlier messages", takesArgs: true },
];

/** `replace` is the part of the text the pick takes the place of; without it the pick is the whole text. */
export type Candidate = {
    label: string;
    description: string;
    insert: string;
    replace?: [number, number];
    /** A command with no arguments: picking it runs it, there is nothing left to type. */
    instant?: "new" | "model";
};

const FILE_MATCHES = 30;

/**
 * Commands and skills whose name matches what follows `/`, the closest first: a letter anywhere in a name finds it,
 * and typing one more letter only takes matches away.
 */
export function slashCandidates(typed: string, skills: readonly SkillInfo[]): Candidate[] {
    const named: (Candidate & { name: string })[] = [
        ...COMMANDS.map((command) => ({
            name: command.name,
            label: `/${command.name}`,
            description: command.description,
            insert: `/${command.name}${command.takesArgs ? " " : ""}`,
            ...(command.name === "new" || command.name === "model"
                ? { instant: command.name }
                : {}),
        })),
        ...skills.map((skill) => ({
            name: skill.name,
            label: `/skill:${skill.name}`,
            description: skill.description,
            insert: `/skill:${skill.name} `,
        })),
    ];

    return named
        .flatMap((candidate) => {
            const score = fuzzyScore(candidate.name, typed);

            return score === null ? [] : [{ candidate, score }];
        })
        .toSorted((left, right) => right.score - left.score)
        .map((each) => each.candidate);
}

/** The project files a `@` mention can mean: the shortest first when nothing follows it, else the closest. */
export function matchingFiles(
    projectFiles: readonly string[],
    mentioned: string | undefined,
): string[] {
    if (mentioned === undefined) {
        return [];
    }

    const usable = projectFiles.filter((path) => !/\s/.test(path));

    if (mentioned === "") {
        return usable.toSorted((left, right) => left.length - right.length).slice(0, FILE_MATCHES);
    }

    return usable
        .flatMap((path) => {
            const score = fuzzyScore(path, mentioned);

            return score === null ? [] : [{ path, score }];
        })
        .toSorted((left, right) => right.score - left.score || left.path.length - right.path.length)
        .slice(0, FILE_MATCHES)
        .map((each) => each.path);
}
