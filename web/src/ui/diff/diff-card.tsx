import { lazy, Suspense, useMemo } from "react";

import { editPatch } from "@/lib/diff.ts";

import { ItemBoundary } from "../item-boundary.tsx";
import { PANE } from "../pane.tsx";
import { Counts } from "./counts.tsx";

const DiffView = lazy(() => import("./diff-view.tsx"));

/**
 * An edit as a card: the file above, then its lines with their numbers, highlighted as code, the words that changed
 * marked brighter.
 */
export function DiffCard({ diff, path }: { diff: string; path?: string }) {
    const adapted = useMemo(() => editPatch(diff), [diff]);
    const fallback = (
        <pre className="text-meta text-muted overflow-x-auto px-3 py-2 font-mono">{diff}</pre>
    );

    return (
        <div className={`${PANE} bg-sunken min-w-0 overflow-hidden`}>
            {path === undefined ? null : (
                <div className="border-edge-soft text-meta text-muted flex h-8 items-center gap-3 border-b px-3 font-mono">
                    <span className="min-w-0 flex-1 truncate">{path}</span>
                    {adapted === undefined ? null : (
                        <Counts added={adapted.added} removed={adapted.removed} />
                    )}
                </div>
            )}
            {adapted === undefined ? (
                fallback
            ) : (
                <ItemBoundary key={diff} name="diff" fallback={fallback}>
                    <Suspense fallback={fallback}>
                        <DiffView patch={adapted.patch} {...(path === undefined ? {} : { path })} />
                        {adapted.note === undefined ? null : (
                            <output className="text-meta text-muted block px-3 py-2">
                                {adapted.note}
                            </output>
                        )}
                    </Suspense>
                </ItemBoundary>
            )}
        </div>
    );
}
