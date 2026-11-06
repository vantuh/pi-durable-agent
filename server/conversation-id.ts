import type { ConversationId } from "@earendil-works/pi-durable";

/**
 * A session id as the harness brands it. The brand lives only in the type, and every id here came
 * from the harness or from a JSON number, so this is the one place the two are taken for the same.
 */
export function idOf(session: number): ConversationId {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return session as ConversationId;
}
