import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { Candidate } from "./candidate.ts";

export function CompletionList({
    matches,
    marked,
    onPick,
}: {
    matches: Candidate[];
    marked: number;
    onPick: (candidate: Candidate) => void;
}) {
    return (
        <Command
            label="Completions"
            shouldFilter={false}
            // A hover paints a row and nothing else: the mark moves on an arrow key or a click.
            disablePointerSelection
            value={matches[Math.min(marked, matches.length - 1)]?.insert ?? ""}
            // Keep focus in the textarea, the popup's own box included.
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            className="border-edge bg-panel shadow-float absolute right-0 bottom-full left-0 mb-1.5 overflow-hidden border"
        >
            <ScrollArea viewportProps={{ className: "max-h-64" }}>
                <CommandList label="Completions" className="p-1">
                    {matches.map((candidate, index) => (
                        <CommandItem
                            key={candidate.insert}
                            value={candidate.insert}
                            // Arrow keys move the mark past the visible part of the list: follow it.
                            ref={
                                index === marked
                                    ? (element) => {
                                          element?.scrollIntoView({ block: "nearest" });
                                      }
                                    : undefined
                            }
                            onSelect={() => {
                                onPick(candidate);
                            }}
                            className="text-meta hover:bg-raised items-baseline px-3 py-2"
                        >
                            <span className="text-ink shrink-0 font-mono">{candidate.label}</span>
                            <span className="text-faint text-meta min-w-0 truncate">
                                {candidate.description}
                            </span>
                        </CommandItem>
                    ))}
                </CommandList>
            </ScrollArea>
        </Command>
    );
}
