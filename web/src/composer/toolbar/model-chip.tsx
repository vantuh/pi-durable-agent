import { ChevronDown, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { thinkingText } from "@/lib/thinking.ts";

export function ModelChip({
    model,
    level,
    menuOpen,
    onToggleMenu,
}: {
    model: string;
    level: string | null;
    menuOpen: boolean;
    onToggleMenu: () => void;
}) {
    return (
        <Button
            variant="ghost"
            onClick={onToggleMenu}
            className={`min-w-0 px-2 py-1 ${menuOpen ? "bg-raised text-ink" : ""}`}
        >
            <Sparkles className="text-accent size-3.5" />
            <span className="max-w-48 min-w-0 truncate font-mono">{model}</span>
            {level === null ? null : (
                <span className={`shrink-0 ${thinkingText(level)}`}>{level}</span>
            )}
            <ChevronDown className="size-3.5 shrink-0" />
        </Button>
    );
}
