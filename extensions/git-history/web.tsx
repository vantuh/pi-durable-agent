import { History as HistoryIcon } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { HISTORY_PAGE } from "./refs.ts";
import { GitStatsItem } from "./web/badge.tsx";
import { GitHistoryPage } from "./web/git-history-page.tsx";

export default {
    pages: [
        {
            id: HISTORY_PAGE,
            title: "Git history",
            icon: <HistoryIcon className="size-4" />,
            tab: false,
            component: GitHistoryPage,
        },
    ],
    header: [{ id: "stats", component: GitStatsItem }],
} satisfies WebExtension;
