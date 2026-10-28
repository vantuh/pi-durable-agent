import { Globe } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

export default {
    tools: [{ id: "web_fetch", icon: Globe }],
} satisfies WebExtension;
