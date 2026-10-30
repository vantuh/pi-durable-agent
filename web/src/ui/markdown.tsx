import { Check, Copy } from "lucide-react";
import { memo, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ThemedToken } from "shiki";

import { cn } from "@/lib/utils";

import { classOf, tokensOf } from "../lib/highlight.ts";

type Highlighted = { code: string; lines: ThemedToken[][] };

/**
 * A fenced block: its language and a copy button above, the code highlighted below. While the code still grows, the
 * last highlighted version shows with the new text after it plain, so a streamed block does not flicker.
 */
export function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
    const [shown, setShown] = useState<Highlighted | undefined>(undefined);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let current = true;

        if (lang === "") {
            return undefined;
        }

        const highlight = async () => {
            try {
                const lines = await tokensOf(code, lang);

                if (current && lines !== undefined) {
                    setShown({ code, lines });
                }
            } catch {
                // A grammar that fails to load leaves the code plain.
            }
        };

        void highlight();

        return () => {
            current = false;
        };
    }, [code, lang]);

    useEffect(() => {
        if (!copied) {
            return undefined;
        }

        const timer = setTimeout(() => {
            setCopied(false);
        }, 1500);

        return () => {
            clearTimeout(timer);
        };
    }, [copied]);

    const fresh = shown !== undefined && code.startsWith(shown.code) ? shown : undefined;

    return (
        <div className="rounded-card border-edge-soft bg-sunken min-w-0 overflow-hidden border">
            <div className="border-edge-soft text-meta text-faint flex h-8 items-center justify-between border-b pr-1.5 pl-3 font-mono">
                <span className="truncate">{title ?? (lang === "" ? "text" : lang)}</span>
                <button
                    type="button"
                    title={copied ? "Copied" : "Copy"}
                    onClick={() => {
                        const copy = async () => {
                            try {
                                await navigator.clipboard.writeText(code);
                                setCopied(true);
                            } catch {
                                // No clipboard (an insecure origin): the icon stays as it was.
                            }
                        };

                        void copy();
                    }}
                    className="rounded-control hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
                >
                    {copied ? (
                        <Check className="text-ok size-3.5" />
                    ) : (
                        <Copy className="size-3.5" />
                    )}
                </button>
            </div>
            <pre className="text-ink overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
                <code>
                    {fresh === undefined
                        ? code
                        : fresh.lines.map((line, row) => (
                              // oxlint-disable-next-line react/no-array-index-key -- lines of one code have no id; their order is the identity
                              <span key={row}>
                                  {line.map((token, at) => (
                                      // oxlint-disable-next-line react/no-array-index-key -- tokens of one line, likewise
                                      <span key={at} className={classOf(token)}>
                                          {token.content}
                                      </span>
                                  ))}
                                  {row < fresh.lines.length - 1 ? "\n" : null}
                              </span>
                          ))}
                    {fresh === undefined ? null : code.slice(fresh.code.length)}
                </code>
            </pre>
        </div>
    );
}

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

const LINK_CLASS =
    "text-info decoration-info/40 hover:decoration-info underline underline-offset-2";

const COMPONENTS: Components = {
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
            <code className="rounded-control bg-raised border-edge-soft border px-1 py-px font-mono text-[0.88em]">
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
    h1: ({ children }) => <h3 className="text-ink mt-2 text-lg font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="text-ink mt-2 text-base font-semibold">{children}</h3>,
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
    table: ({ children }) => (
        <div className="rounded-card border-edge-soft overflow-x-auto border">
            <table className="text-interface w-full border-collapse">{children}</table>
        </div>
    ),
    th: ({ children }) => (
        <th className="border-edge-soft bg-panel text-ink border-b px-3 py-1.5 text-left font-semibold">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border-edge-soft text-ink border-b px-3 py-1.5 align-top">{children}</td>
    ),
};

/** Pi's words as Markdown, GitHub's flavour: tables, task lists, strikethrough, autolinks. */
export const Markdown = memo(function Markdown({
    text,
    streaming = false,
}: {
    text: string;
    streaming?: boolean;
}): ReactNode {
    return (
        <div
            className={cn(
                "text-prose text-ink flex min-w-0 flex-col gap-3 leading-relaxed break-words",
                streaming && "streaming",
            )}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {text}
            </ReactMarkdown>
        </div>
    );
});
