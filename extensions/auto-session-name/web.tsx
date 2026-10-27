import { Sparkles } from "lucide-react";

import { callAction } from "@/sdk/actions.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { generate } from "./refs.ts";

export default {
    sessionMenu: [
        {
            id: "generate-name",
            label: "Generate name",
            icon: <Sparkles />,
            run: async (session) => {
                await callAction(generate, undefined, session);
            },
        },
    ],
} satisfies WebExtension;
