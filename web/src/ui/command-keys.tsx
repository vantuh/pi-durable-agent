import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useCommandKeys, type ShellCommand } from "@/sdk/commands.ts";

/**
 * The keys that run a shell command, for a hint's `keys` slot: one cap per key, as the extension that
 * stated them draws them. Nothing at all while no extension states any, so the hint keeps the width
 * of its label alone.
 */
export function CommandKeys({ command }: { command: ShellCommand }) {
    const keys = useCommandKeys(command);

    return keys === null ? null : (
        <KbdGroup>
            {keys.map((chord, at) =>
                chord.map((key, index) => <Kbd key={`${String(at)}.${String(index)}`}>{key}</Kbd>),
            )}
        </KbdGroup>
    );
}
