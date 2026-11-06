import { useEffect, useState } from "react";

// The times in the rows are read off this, so they move on while nothing else does.
export function useMinute(): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, 60_000);

        return () => {
            clearInterval(tick);
        };
    }, []);

    return now;
}
