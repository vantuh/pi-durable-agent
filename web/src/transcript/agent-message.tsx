import { Bot, ChevronRight, SquareArrowOutUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Hint } from "@/components/ui/tooltip";

import type { ClientAuthor } from "../../../shared/protocol.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { Markdown } from "../ui/markdown.tsx";
import { PANE } from "../ui/pane.tsx";

type Props = {
    text: string;
    author: ClientAuthor;
    onOpenSession: (session: number) => void;
};

/**
 * A message an agent wrote into this conversation, not the person: a card on the left under its name, folded to its
 * first line, so a long report does not push the conversation away. Open goes to the conversation it came from.
 */
export function AgentMessage({ text, author, onOpenSession }: Props) {
    // One line of plain words: the marks a folded line cannot render would only be noise.
    const preview = (text.trim().split("\n", 1)[0] ?? "").replace(/[*_`#>]+/g, "").trim();
    const { session } = author;

    return (
        <Collapsible className={`group/agent ${PANE} bg-panel relative overflow-hidden`}>
            <span aria-hidden className="bg-agent w-stripe absolute inset-y-0 left-0" />
            <div className="text-meta flex items-center gap-1 py-1.5 pr-1.5 pl-3">
                <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <ChevronRight className="text-faint size-3.5 shrink-0 transition-transform group-data-[state=open]/agent:rotate-90" />
                    <Bot className="text-agent size-3.5 shrink-0" />
                    <span className="text-agent shrink-0 font-medium">{author.name}</span>
                    <span className="text-muted min-w-0 truncate group-data-[state=open]/agent:hidden">
                        {preview}
                    </span>
                </CollapsibleTrigger>
                {session === undefined ? null : (
                    <Hint label={`Open ${author.name}'s conversation`}>
                        <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
                            <a
                                href={sessionHref(session)}
                                aria-label={`Open ${author.name}'s conversation`}
                                onClick={(event) => {
                                    if (isPlainClick(event)) {
                                        event.preventDefault();
                                        onOpenSession(session);
                                    }
                                }}
                            >
                                <SquareArrowOutUpRight className="size-3.5" />
                            </a>
                        </Button>
                    </Hint>
                )}
            </div>
            <CollapsibleContent className="text-prose px-3 pb-2.5">
                <Markdown text={text} />
            </CollapsibleContent>
        </Collapsible>
    );
}
