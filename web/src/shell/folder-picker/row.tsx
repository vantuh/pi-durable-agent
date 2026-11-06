import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { Hint } from "@/components/ui/tooltip";

export function Row({
    icon,
    label,
    active,
    selected,
    folder,
    onIcon,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    /** The row the caret is on: Enter starts a session here, and the row stays marked. */
    selected?: boolean;
    /** What Enter starts a session in, and what the keys read as this row. Undefined while the list loads. */
    folder: string | undefined;
    onIcon?: () => void;
    onClick: () => void;
}) {
    return (
        <Item
            size="sm"
            className={`text-interface ${
                active === true || selected === true
                    ? "bg-raised text-ink"
                    : "text-muted hover:bg-raised"
            }`}
        >
            {onIcon === undefined ? (
                icon
            ) : (
                <Hint label="Favourite">
                    <Button
                        variant="ghost"
                        aria-label="Favourite"
                        onClick={onIcon}
                        className="size-4 shrink-0 p-0 hover:bg-transparent"
                    >
                        {icon}
                    </Button>
                </Hint>
            )}
            <button
                type="button"
                data-folder={folder}
                aria-current={selected === true ? "true" : undefined}
                onClick={onClick}
                className="focus-visible:ring-accent min-w-0 flex-1 text-left outline-none focus-visible:ring-2"
            >
                <span className="block truncate">{label}</span>
            </button>
        </Item>
    );
}
