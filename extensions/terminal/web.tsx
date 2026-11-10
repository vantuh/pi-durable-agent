import { SquareTerminal } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { TERMINAL_PAGE } from "./refs.ts";
import { TerminalButton } from "./web/header-button.tsx";
import { TerminalPage } from "./web/page.tsx";

export default {
    pages: [
        {
            id: TERMINAL_PAGE,
            title: "Terminal",
            icon: <SquareTerminal className="size-4" />,
            tab: false,
            component: TerminalPage,
        },
    ],
    header: [{ id: "open", component: TerminalButton }],
} satisfies WebExtension;
