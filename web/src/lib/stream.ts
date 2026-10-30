/**
 * A stream the browser closed for good, such as the proxy's 502 while the server restarts, is not retried by the
 * browser: EventSource does that only for a connection it lost. The app opens its own, one second later, then two,
 * four, and every five after that: a server that comes back is found again, and one that stays down is not hammered.
 */
export function reopenDelay(attempts: number): number {
    return Math.min(1000 * 2 ** attempts, 5000);
}
