import { Bot } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { AgentsArea } from "./web/agents-area.tsx";
import { AgentsMarker } from "./web/agents-marker.tsx";
import { AgentsSubmenu } from "./web/agents-submenu.tsx";
import { AgentsWorking } from "./web/agents-working.tsx";
import { Agents } from "./web/agents.tsx";
import { hasWorkingAgent } from "./web/area.ts";
import { ModelsSection } from "./web/models-section.tsx";

export default {
    tools: ["agent_spawn", "agent_send", "agent_stop", "agent_status"].map((id) => ({
        id,
        icon: Bot,
    })),
    aboveComposer: [{ id: "agents", component: Agents }],
    sidebarBottom: [{ id: "agents", component: AgentsArea }],
    settings: [{ id: "models", title: "Subagent models", component: ModelsSection }],
    status: [{ id: "agents-working", slot: "start", component: AgentsWorking }],
    statusRow: [
        { id: "agents", has: hasWorkingAgent, component: AgentsMarker, submenu: AgentsSubmenu },
    ],
} satisfies WebExtension;
