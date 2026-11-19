import { SquareTerminal } from "lucide-react";

import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import type { HomeProps } from "@/sdk/types.ts";
import { GroupHeading } from "@/ui/group-heading.tsx";

import { TERMINAL_PAGE } from "../refs.ts";
import { useAllFolderTabs } from "./use-folder-tabs.ts";

/** Every folder's terminal tabs on the home page, folder by folder: a row opens the Terminal page on its tab. */
export function HomeTerminals({ openPage }: HomeProps) {
    const all = useAllFolderTabs();

    if (all.length === 0) {
        return null;
    }

    return (
        <div>
            <GroupHeading>
                Terminals {all.reduce((count, entry) => count + entry.tabs.length, 0)}
            </GroupHeading>
            {all.map((entry) => (
                <section key={entry.cwd} aria-label={entry.cwd}>
                    <h3
                        title={entry.cwd}
                        className="text-meta text-faint truncate py-1 pl-6 font-mono"
                    >
                        {entry.cwd.split("/").at(-1) ?? entry.cwd}
                    </h3>
                    {entry.tabs.map((tab) => (
                        <Item key={tab.id} asChild className="hover:bg-raised/50 w-full text-left">
                            <button
                                type="button"
                                onClick={() => {
                                    openPage(entry.cwd, TERMINAL_PAGE, String(tab.id));
                                }}
                            >
                                {/* 12px drawn in the 8px a session row's mark takes, so the titles line up under the heading. */}
                                <SquareTerminal className="text-faint -mx-0.5 size-3 shrink-0" />
                                <ItemContent>
                                    <ItemTitle className="font-mono">{tab.title}</ItemTitle>
                                </ItemContent>
                                {tab.exited ? (
                                    <span className="text-meta text-faint shrink-0">stopped</span>
                                ) : null}
                            </button>
                        </Item>
                    ))}
                </section>
            ))}
        </div>
    );
}
