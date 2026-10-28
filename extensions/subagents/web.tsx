import { Bot } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

export default {
    tools: ["agent_spawn", "agent_send", "agent_stop", "agent_status"].map((id) => ({
        id,
        icon: Bot,
    })),
} satisfies WebExtension;
