import type { Components, ExtraProps } from "react-markdown";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { CodeBlock } from "./code-block.tsx";

type HastNode = NonNullable<ExtraProps["node"]>["children"][number];

function textOf(node: HastNode): string {
    if (node.type === "text") {
        return node.value;
    }

    return node.type === "element" ? node.children.map(textOf).join("") : "";
}

/** The fence's language, from the `language-x` class remark gives its `code`. */
function langOf(className: unknown): string {
    const names = Array.isArray(className) ? className : [className];
    const found = names.find(
        (name): name is string => typeof name === "string" && name.startsWith("language-"),
    );

    return found === undefined ? "" : found.slice("language-".length);
}

// A link in prose is a mark, not a control: an underline, and the ring around it.
const LINK_CLASS =
    "text-info decoration-info/40 focus-visible:ring-accent underline underline-offset-2 outline-none hover:decoration-info focus-visible:ring-2";

export const COMPONENTS: Components = {
    pre({ node }) {
        const code = node?.children[0];

        if (code?.type !== "element" || code.tagName !== "code") {
            return null;
        }

        return (
            <CodeBlock
                code={textOf(code).replace(/\n$/, "")}
                lang={langOf(code.properties["className"])}
            />
        );
    },
    code({ children }) {
        return (
            // A relative size, not a step: inline code sits in prose of any size and stays just under it.
            <code className="bg-raised border-edge-soft border px-1 py-px font-mono text-[0.88em]">
                {children}
            </code>
        );
    },
    a({ href, children }) {
        return (
            <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                {children}
            </a>
        );
    },
    img({ src, alt }) {
        // An image would load from wherever a model answer names, unasked; a link waits for the click.
        return typeof src === "string" && src !== "" ? (
            <a href={src} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                {alt === undefined || alt === "" ? src : alt}
            </a>
        ) : null;
    },
    h1: ({ children }) => <h3 className="text-ink text-heading mt-2 font-semibold">{children}</h3>,
    h2: ({ children }) => (
        <h3 className="text-ink text-subheading mt-2 font-semibold">{children}</h3>
    ),
    h3: ({ children }) => <h4 className="text-ink mt-1 font-semibold">{children}</h4>,
    h4: ({ children }) => <h5 className="text-ink font-semibold">{children}</h5>,
    ul: ({ children }) => (
        <ul className="marker:text-faint flex list-disc flex-col gap-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="marker:text-faint flex list-decimal flex-col gap-1 pl-5">{children}</ol>
    ),
    blockquote: ({ children }) => (
        <blockquote className="border-edge text-muted border-l-2 pl-3">{children}</blockquote>
    ),
    hr: () => <hr className="border-edge-soft" />,
    table: ({ children }) => <Table>{children}</Table>,
    // `| | |` states no column names, only the delimiter GFM demands; an empty header row is still a row.
    thead: ({ node, children }) => (
        <TableHeader className={node !== undefined && textOf(node).trim() === "" ? "sr-only" : ""}>
            {children}
        </TableHeader>
    ),
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow>{children}</TableRow>,
    // GFM states a column's alignment as an inline `text-align`; the header's own `text-left` would win over a
    // class, so the style is handed through and an aligned column stays aligned.
    th: ({ style, children }) => <TableHead style={style}>{children}</TableHead>,
    td: ({ style, children }) => <TableCell style={style}>{children}</TableCell>,
};
