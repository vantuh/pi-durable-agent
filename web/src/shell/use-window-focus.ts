import { useEffect } from "react";

import { restoreComposerFocus } from "@/sdk/composer.ts";

// Coming back to the window or tab: Chromium restores the focused element itself, so only an unclaimed
// keyboard is filled.
export function useWindowFocus(): void {
    useEffect(() => {
        const back = (): void => {
            if (document.visibilityState === "visible") {
                restoreComposerFocus("window");
            }
        };

        window.addEventListener("focus", back);
        document.addEventListener("visibilitychange", back);

        return () => {
            window.removeEventListener("focus", back);
            document.removeEventListener("visibilitychange", back);
        };
    }, []);
}
