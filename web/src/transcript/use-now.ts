import { useEffect, useState } from "react";

/** The current time, every second while `live`; a settled clock never redraws. */
export function useNow(live: boolean): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!live) {
            return undefined;
        }

        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, [live]);

    return now;
}
