import { Files } from "lucide-react";

import type { WebExtension } from "@/sdk/types.ts";

import { FilesPanel } from "./panel.tsx";

export default {
    panels: [
        {
            id: "files",
            title: "Files",
            icon: <Files className="size-4" />,
            component: FilesPanel,
        },
    ],
} satisfies WebExtension;
