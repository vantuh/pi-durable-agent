/**
 * A stream the browser closed for good, such as the proxy's 502 while the server restarts, is not retried by the
 * browser: EventSource does that only for a connection it lost. The app opens its own, one second later, then two,
 * four, and every five after that: a server that comes back is found again, and one that stays down is not hammered.
 */
export function reopenDelay(attempts: number): number {
    return Math.min(1000 * 2 ** attempts, 5000);
}

/**
 * One EventSource kept open: a stream the browser closes for good is opened again from here, since it retries only a
 * connection it lost. `onError` fires for every error, the reconnects the browser makes on its own included. Returns
 * the function that closes the stream and cancels a pending reopen.
 */
export function openStream(
    url: string,
    handlers: {
        onMessage: (data: string) => void;
        onOpen?: () => void;
        onError?: () => void;
    },
): () => void {
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const connect = (): void => {
        const stream = new EventSource(url);

        source = stream;
        stream.onopen = () => {
            failures = 0;
            handlers.onOpen?.();
        };
        stream.onerror = () => {
            handlers.onError?.();

            // Anything else is the browser reconnecting on its own, and it does that better than this would.
            if (stream.readyState !== EventSource.CLOSED) {
                return;
            }

            timer = setTimeout(connect, reopenDelay(failures));
            failures += 1;
        };
        stream.onmessage = (message: MessageEvent<string>) => {
            handlers.onMessage(message.data);
        };
    };

    connect();

    return () => {
        clearTimeout(timer);
        source?.close();
    };
}
