import { CircleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { readProviderError } from "@/lib/provider-error.ts";

export function ErrorNotice({ text }: { text: string }) {
    const { title, detail, requestId } = readProviderError(text);

    return (
        <Alert>
            <CircleAlert />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span>{title}</span>
                {detail === undefined && requestId === undefined ? null : (
                    <span className="text-faint font-mono break-all">
                        {[detail, requestId].filter((part) => part !== undefined).join(" · ")}
                    </span>
                )}
            </div>
        </Alert>
    );
}
