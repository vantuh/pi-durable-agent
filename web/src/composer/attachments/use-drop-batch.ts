import { useEffect, useState } from "react";

import type { Pending } from "@/ui/attachments.tsx";

/** Keys of the files from the last drop, kept until they have uploaded and the card has been seen. */
export function useDropBatch(files: Pending[]): [Pending[], (keys: string[]) => void] {
    const [keys, setKeys] = useState<string[]>([]);
    const batch = files.filter((file) => keys.includes(file.key));
    const busy = batch.some((file) => file.state === "uploading");

    useEffect(() => {
        const timer =
            keys.length === 0 || busy
                ? undefined
                : setTimeout(() => {
                      setKeys([]);
                  }, 900);

        return () => {
            clearTimeout(timer);
        };
    }, [keys, busy]);

    return [batch, setKeys];
}
