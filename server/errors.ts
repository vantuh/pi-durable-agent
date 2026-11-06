/** The two failures an extension action raises, and the status each one answers with (`failureOf` in `http.ts`). */

/** Thrown by an action for bad input from the caller; the route answers 400 with the message. */
export class ActionError extends Error {}

/** Thrown for an unknown extension or action; the route answers 404. */
export class ActionNotFound extends Error {}
