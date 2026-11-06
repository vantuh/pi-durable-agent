import type { Command, Redirection } from "unbash";

/** Programs that run the next word as the command, so the icon is that word's. */
const WRAPPERS = new Set([
    "sudo",
    "env",
    "timeout",
    "nohup",
    "time",
    "exec",
    "command",
    "nice",
    "xargs",
]);

/** What joins a part to the next, said in words. */
export const JOINS: Readonly<Record<string, string>> = {
    "&&": "if it succeeds",
    "||": "if it fails",
    "|": "output into",
    "|&": "all output into",
};

/** The file name of the program a command runs, past wrappers such as `sudo` or `timeout 3`. */
export function program(command: Command): string | undefined {
    let wrapped = false;

    for (const word of [command.name, ...command.args]) {
        if (word?.type !== "Word") {
            continue;
        }

        // shortcut: a wrapper's options are skipped only when they look like one (`-u`, `3`, `X=1`); `sudo -u root`
        // takes `root` as the program, until wrappers get their own option tables.
        if (wrapped && /^-|^\d|=/.test(word.value)) {
            continue;
        }

        const name = word.value.split("/").at(-1) ?? word.value;

        if (!WRAPPERS.has(name)) {
            return name;
        }

        wrapped = true;
    }

    return undefined;
}

/** The source of `pos`..`end` without `command`'s redirects, which the panels show as badges instead. */
export function bare(source: string, pos: number, end: number, command?: Command): string {
    const join = (text: string, next: string) =>
        text === "" ? next : `${text.trimEnd()} ${next.trimStart()}`;
    let text = "";
    let at = pos;

    for (const redirect of command?.redirects ?? []) {
        text = join(text, source.slice(at, redirect.pos));
        at = redirect.end;
    }

    return join(text, source.slice(at, end)).trim();
}

/** A redirect in words: what it writes or reads, or what it hides. One this does not know stays as written. */
export function redirectLabel(source: string, redirect: Redirection): string {
    const written = source.slice(redirect.pos, redirect.end);

    if (redirect.type !== "Redirect") {
        return written;
    }

    const target = redirect.target?.value ?? "";
    const errors =
        redirect.descriptor?.type === "FileDescriptor" && redirect.descriptor.value === 2;
    const all = redirect.operator === "&>" || redirect.operator === "&>>";

    if (redirect.operator === ">&") {
        return errors && target === "1"
            ? "errors into output"
            : target === "2"
              ? "into errors"
              : written;
    }

    if (target === "/dev/null" && redirect.operator !== "<") {
        return all ? "hides all output" : errors ? "hides errors" : "hides output";
    }

    if (redirect.operator === ">" || redirect.operator === ">|") {
        return errors ? `errors → ${target}` : `writes ${target}`;
    }

    if (redirect.operator === ">>") {
        return errors ? `errors → ${target}` : `appends to ${target}`;
    }

    if (all) {
        return `all output → ${target}`;
    }

    return redirect.operator === "<" ? `reads ${target}` : written;
}
