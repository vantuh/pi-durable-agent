import type { WebExtension } from "@/sdk/types.ts";
import { CodeBlock } from "@/ui/markdown/code-block.tsx";

export default {
    toolViews: [
        {
            id: "codemode",
            args: (args) => {
                const code =
                    typeof args === "object" && args !== null ? Reflect.get(args, "code") : null;

                return typeof code === "string" ? <CodeBlock code={code} lang="js" /> : null;
            },
        },
    ],
} satisfies WebExtension;
