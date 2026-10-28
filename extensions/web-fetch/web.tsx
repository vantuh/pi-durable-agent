import { Globe } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

export default {
    tools: [{ id: "fetch_content", icon: Globe }],
} satisfies WebExtension;
