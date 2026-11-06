import { type RefObject, useEffect, useRef, useState } from "react";

/** Narrower than this, two columns are each too narrow to read: the card keeps one. */
const SPLIT_FROM = 560;

/** Whether the card itself has room for two columns: the conversation column is not the window. */
export function useRoom(): [RefObject<HTMLDivElement | null>, boolean] {
    const root = useRef<HTMLDivElement>(null);
    const [room, setRoom] = useState(() => window.innerWidth >= SPLIT_FROM);

    useEffect(() => {
        const box = root.current;

        if (box === null) {
            return undefined;
        }

        const measure = (): void => {
            setRoom(box.clientWidth >= SPLIT_FROM);
        };
        const observer = new ResizeObserver(measure);

        observer.observe(box);
        measure();

        return () => {
            observer.disconnect();
        };
    }, []);

    return [root, room];
}
