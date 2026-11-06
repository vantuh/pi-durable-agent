import { parse, type AndOr, type Command, type PipelineNode, type Statement } from "unbash";

const INDENT = "  ";
/** A chain this short reads at a glance on one line, as `git status | head` does. */
const SHORT = 60;

/**
 * One row of a laid-out command. A `command` is the source range `pos`..`end`, with the `&&`, `||` or `|` that joins it
 * to the next; `command` is set when that range is one simple command, for its redirects, and `head` is the command
 * whose program names the row: that one, or the first of a short pipeline.
 */
export type Part =
    | { kind: "comment"; text: string }
    | { kind: "blank" }
    | { kind: "code"; text: string }
    | {
          kind: "command";
          pos: number;
          end: number;
          depth: number;
          operator?: string;
          command?: Command;
          head?: Command;
      };

/** A gap between statements keeps its comments, each on its own line, and one blank line where it had any. */
function gap(text: string, parts: Part[]): void {
    const rows = text.split("\n");

    rows.forEach((row, index) => {
        const rest = row.replace(/^[\s;]*/, "");
        // The first and last rows share a line with a statement, so only a row between them can be blank.
        const blank = rest === "" && index > 0 && index < rows.length - 1;

        if (rest.startsWith("#")) {
            parts.push({ kind: "comment", text: rest });
        } else if (blank && parts.length > 0 && parts.at(-1)?.kind !== "blank") {
            parts.push({ kind: "blank" });
        }
    });
}

/** One part of a long chain per row; a later part is a level deeper than the first. */
function unfold(node: Statement | AndOr | PipelineNode, depth: number): Part[] {
    const parts =
        node.type === "Statement"
            ? [node.command]
            : node.type === "AndOr" || node.type === "Pipeline"
              ? node.commands
              : [];
    const operators = node.type === "AndOr" || node.type === "Pipeline" ? node.operators : [];

    const head =
        node.type === "Command" ? node : parts[0]?.type === "Command" ? parts[0] : undefined;

    if (
        parts.length === 0 ||
        (node.type !== "Statement" && (parts.length < 2 || node.end - node.pos <= SHORT))
    ) {
        return [
            {
                kind: "command",
                pos: node.pos,
                end: node.end,
                depth,
                ...(node.type === "Command" ? { command: node } : {}),
                ...(head === undefined ? {} : { head }),
            },
        ];
    }

    const rows = parts.flatMap((part, index) => {
        const own = unfold(part, index === 0 ? depth : depth + 1);
        const last = own.at(-1);
        const operator = operators[index];

        if (operator !== undefined && last?.kind === "command") {
            last.operator = operator;
        }

        return own;
    });

    // What the node holds around its parts, a `!` or `time` before them and a statement's `&` after, joins the parts.
    const first = rows[0];
    const last = rows.at(-1);

    if (first?.kind === "command") {
        first.pos = node.pos;
    }

    if (last?.kind === "command") {
        last.end = node.end;
    }

    return rows;
}

/**
 * The command as rows: one statement each, and every long `&&`, `||` and `|` chain one part each. A statement already
 * written over several lines is one `code` row. Undefined for a command that does not parse.
 */
export function split(command: string): Part[] | undefined {
    // shortcut: a heredoc body follows its line, so splitting that line could move the body; such a command stays as
    // written (a `<<<` here-string too), until heredoc nodes are tracked.
    if (command.includes("<<")) {
        return undefined;
    }

    const script = parse(command);

    if (script.errors !== undefined && script.errors.length > 0) {
        return undefined;
    }

    const parts: Part[] = [];
    let at = 0;

    for (const statement of script.commands) {
        gap(command.slice(at, statement.pos), parts);

        const text = command.slice(statement.pos, statement.end);

        parts.push(
            ...(text.includes("\n") ? [{ kind: "code", text } as const] : unfold(statement, 0)),
        );
        at = statement.end;
    }

    gap(command.slice(at), parts);

    return parts;
}

/**
 * The same command, laid out to read: one statement per line, and every long `&&`, `||` and `|` chain one part per
 * line, a later part indented under the first. A command that does not parse stays as it is.
 */
export function layout(command: string): string {
    const parts = split(command);

    if (parts === undefined) {
        return command;
    }

    return parts
        .map((part) =>
            part.kind === "blank"
                ? ""
                : part.kind === "command"
                  ? INDENT.repeat(part.depth) +
                    command.slice(part.pos, part.end) +
                    (part.operator === undefined ? "" : ` ${part.operator}`)
                  : part.text,
        )
        .join("\n")
        .trim();
}
