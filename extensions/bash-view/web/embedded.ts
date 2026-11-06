import { forEachChild, parse, type Command, type SyntaxNode, type WordPart } from "unbash";

type Embedded = { pos: number; end: number; lang: "python" | "javascript" };

function literal(part: WordPart): boolean {
    return (
        part.type === "Literal" ||
        part.type === "SingleQuoted" ||
        (part.type === "DoubleQuoted" && part.parts.every(literal))
    );
}

function extract(command: Command): Embedded | undefined {
    const name = command.name;

    if (name === undefined || !(name.parts ?? []).every(literal)) {
        return undefined;
    }

    const program = name.value.split("/").at(-1);
    const lang =
        program === "python" || program === "python3"
            ? "python"
            : program === "node"
              ? "javascript"
              : undefined;

    if (lang === undefined) {
        return undefined;
    }

    const args = command.args;
    let at = 0;

    // shortcut: only known flag-only options precede code; extend this list when another option is needed.
    const options =
        lang === "python"
            ? new Set(["-u", "-B", "-I", "-S", "-E", "-s", "-O", "-OO"])
            : new Set(["--input-type=module", "--input-type=commonjs"]);

    for (const arg of args) {
        if (arg.type !== "Word" || !options.has(arg.value) || !(arg.parts ?? []).every(literal)) {
            break;
        }

        at += 1;
    }

    const flag = args[at];

    if (
        flag?.type === "Word" &&
        (lang === "python" ? flag.value === "-c" : ["-e", "--eval"].includes(flag.value)) &&
        (flag.parts ?? []).every(literal)
    ) {
        const code = args[at + 1];

        if (code?.type !== "Word" || !(code.parts ?? []).every(literal)) {
            return undefined;
        }

        const part = code.parts?.[0];
        const quoted =
            code.parts?.length === 1 &&
            (part?.type === "SingleQuoted" || part?.type === "DoubleQuoted");

        // shortcut: inline grammar sees shell escapes; use decoded-token source maps if exact escape-heavy colouring is needed.
        return { pos: code.pos + (quoted ? 1 : 0), end: code.end - (quoted ? 1 : 0), lang };
    }

    // A script path or an unknown option may consume stdin as data, not as code.
    if (
        args.length !== at &&
        !(args.length === at + 1 && flag?.type === "Word" && flag.value === "-")
    ) {
        return undefined;
    }

    const inputs = command.redirects.filter((redirect) => {
        const stdin =
            redirect.descriptor === undefined ||
            (redirect.descriptor.type === "FileDescriptor" && redirect.descriptor.value === 0) ||
            redirect.descriptor.type === "FileDescriptorVariable";

        return (
            stdin && (redirect.type !== "Redirect" || ["<", "<>", "<&"].includes(redirect.operator))
        );
    });
    const input = inputs[0];

    if (
        inputs.length !== 1 ||
        input?.type !== "HereDoc" ||
        input.closing === undefined ||
        input.descriptor?.type === "FileDescriptorVariable" ||
        !(input.body.parts ?? []).every(literal)
    ) {
        return undefined;
    }

    // shortcut: unquoted heredocs with backslashes stay raw until shell escape decoding is needed.
    if (input.delimiter?.quoted !== true && input.body.text.includes("\\")) {
        return undefined;
    }

    return {
        pos: input.body.pos,
        end: input.body.end,
        lang,
    };
}

/** Source ranges of static interpreter code; shell spelling stays intact for rendering and copying. */
export function embedded(source: string): Embedded[] {
    const script = parse(source);

    if ((script.errors?.length ?? 0) > 0) {
        return [];
    }

    const result: Embedded[] = [];
    const visit = (node: SyntaxNode): void => {
        if (node.type === "Command") {
            const code = extract(node);

            if (code !== undefined) {
                result.push(code);
            }
        } else {
            forEachChild(node, visit);
        }
    };

    visit(script);

    return result;
}
