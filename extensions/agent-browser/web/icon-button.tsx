import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function IconButton({
    hint,
    onClick,
    disabled,
    active,
    className = "",
    children,
}: {
    /** The action, which is also the name: the toolbar holds no text a screen reader could read. */
    hint: string;
    onClick: () => void;
    disabled?: boolean;
    /** Set only by a toggle or a choice among several: a button that acts on each press carries no state to announce. */
    active?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <Hint label={hint}>
            <Button
                variant="ghost"
                size="icon"
                aria-label={hint}
                aria-pressed={active}
                disabled={disabled === true}
                onClick={onClick}
                className={`shrink-0 disabled:opacity-40 disabled:hover:bg-transparent ${active === true ? "bg-raised text-ink" : ""} ${className}`}
            >
                {children}
            </Button>
        </Hint>
    );
}
