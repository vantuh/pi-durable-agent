import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { refreshExtensions, useToggleExtensions } from "@/extensions.ts";
import { setExtensionEnabled } from "@/lib/api.ts";
import { toast } from "@/lib/toast.ts";

/** One switch per folder with `meta.toggle`; shown whether the folder is on or off. Nothing when none asks. */
export function ExtensionToggles() {
    const rows = useToggleExtensions();

    if (rows.length === 0) {
        return null;
    }

    return (
        <>
            <Separator />
            <section className="flex flex-col gap-1.5 p-3">
                <h3 className="text-meta text-faint">Extensions</h3>
                {rows.map((row) => (
                    <label
                        key={row.name}
                        className="text-interface text-ink flex items-center justify-between gap-3"
                    >
                        {row.title}
                        <Switch
                            checked={row.enabled}
                            onCheckedChange={(enabled) => {
                                void toggle(row.name, row.title, enabled);
                            }}
                        />
                    </label>
                ))}
            </section>
        </>
    );
}

async function toggle(name: string, title: string, enabled: boolean): Promise<void> {
    try {
        await setExtensionEnabled(name, enabled);
    } catch (error) {
        toast.error(`${title}: ${error instanceof Error ? error.message : "the change failed"}`);
    }

    // Also after a refusal: the switch is drawn from the server's answer, so it goes back.
    await refreshExtensions();
}
