import { type ComponentType, lazy, Suspense } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";
import { ItemBoundary } from "@/ui/item-boundary.tsx";
import { Loading } from "@/ui/loading.tsx";

function isComponent(value: unknown): value is ComponentType<ExtensionDetailsProps> {
    return typeof value === "function";
}

// Separate from web.tsx: inspecting a disabled folder must not activate its browser features.
const details = new Map(
    Object.entries(import.meta.glob("../../../../extensions/*/details.tsx"))
        .filter(([path]) => {
            const folder = path.split("/").at(-2) ?? "";
            return !folder.startsWith("_") && !folder.startsWith(".");
        })
        .map(([path, load]) => [
            path.split("/").at(-2),
            lazy(async () => {
                const module: unknown = await load();
                const component: unknown =
                    typeof module === "object" && module !== null
                        ? Reflect.get(module, "default")
                        : undefined;
                if (!isComponent(component)) {
                    throw new Error("details.tsx must default-export a function component");
                }
                return { default: component };
            }),
        ]),
);

export function hasExtensionDetails(folder: string): boolean {
    return details.has(folder);
}

export function ExtensionDetails({ folder, ...props }: ExtensionDetailsProps & { folder: string }) {
    const Details = details.get(folder);
    if (Details === undefined) {
        return null;
    }
    return (
        <ItemBoundary
            key={`${folder}:${String(props.enabled)}:${String(props.installed)}`}
            name={`${folder}:details`}
            fallback={<Alert>Could not load extension details.</Alert>}
        >
            <Suspense fallback={<Loading className="text-meta">Loading details…</Loading>}>
                {/* oxlint-disable-next-line react/static-components -- lazy components are cached once in the module-level map */}
                <Details {...props} />
            </Suspense>
        </ItemBoundary>
    );
}
