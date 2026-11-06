import type { WebExtension } from "@/sdk/types.ts";

import { BashView } from "./web/bash-view.tsx";

export default {
    toolViews: [
        {
            id: "bash",
            args: (args) => {
                const command =
                    typeof args === "object" && args !== null ? Reflect.get(args, "command") : null;

                return typeof command === "string" ? <BashView command={command} /> : null;
            },
        },
    ],
} satisfies WebExtension;
