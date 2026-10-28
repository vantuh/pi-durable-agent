import { Search } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

export default {
    tools: [{ id: "web_search", icon: Search }],
} satisfies WebExtension;
