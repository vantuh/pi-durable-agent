import { SquareTerminal } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { TerminalPanel } from "./panel.tsx";

export default {
    panels: [
        {
            id: "terminal",
            title: "Terminal",
            icon: <SquareTerminal className="size-4" />,
            component: TerminalPanel,
        },
    ],
} satisfies WebExtension;
