import { createContext, useContext } from "react";

/** The conversation on screen: the steps of the transcript ask it for the URLs of what the server holds. */
export const SessionContext = createContext<number | null>(null);

export function useSession(): number | null {
    return useContext(SessionContext);
}
