import { Bot, Globe } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { AgentBrowserPanel } from "./web/panel.tsx";

export default {
    panels: [
        {
            id: "agent-browser",
            title: "Agent Browser",
            icon: <Bot className="size-4" />,
            component: AgentBrowserPanel,
        },
    ],
    tools: [{ id: "browser", icon: Globe }],
} satisfies WebExtension;
