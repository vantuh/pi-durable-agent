import { Globe } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { BrowserPanel } from "./panel.tsx";

export default {
    panels: [
        {
            id: "browser",
            title: "Browser",
            icon: <Globe className="size-4" />,
            component: BrowserPanel,
        },
    ],
} satisfies WebExtension;
