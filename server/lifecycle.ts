// Storage must have one owner before boot begins and until every storage user has closed.

import { mkdir, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { answer } from "./http.ts";

export type Lifecycle = {
    /** Runs when stopping, in the order registered, before the lock is let go. */
    onStop: (close: () => Promise<void>) => void;
    /** Starts answering requests. */
    ready: () => void;
    /** Stops answering, runs the closers, lets go of the lock. If a closer fails the lock stays held. */
    stop: () => Promise<void>;
};

type Options = {
    dataDir: string;
    port: number;
    handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
};

const SQLITE_BUSY = 5;

// Keep the sidecar inode: unlinking it would let a competitor lock a replacement while this owner still runs.
async function ownStorage(dataDir: string): Promise<() => Promise<void>> {
    await mkdir(dataDir, { recursive: true });

    const file = join(await realpath(dataDir), "state.sqlite");
    const canonical = await realpath(file).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return file;
        }

        throw error;
    });
    const owner = new DatabaseSync(`${canonical}.owner.sqlite`);

    try {
        owner.exec("PRAGMA busy_timeout = 0");
        owner.exec("BEGIN EXCLUSIVE");
    } catch (error) {
        owner.close();

        if (error instanceof Error && "errcode" in error && error.errcode === SQLITE_BUSY) {
            throw new Error(
                `${canonical} is in use by another server. Stop it, or set PI_DURABLE_DATA_DIR to another folder.`,
                { cause: error },
            );
        }

        throw error;
    }

    return () => {
        try {
            owner.exec("ROLLBACK");
        } finally {
            owner.close();
        }

        return Promise.resolve();
    };
}

export async function listen(options: Options): Promise<Lifecycle> {
    const release = await ownStorage(options.dataDir);
    const closers: Array<() => Promise<void>> = [];
    let admitting = false;
    let stopping: Promise<void> | undefined;

    const server = createServer((request, response) => {
        if (!admitting) {
            // A reset, like a port nobody listens on: an EventSource retries that, and gives up on a 503.
            request.socket.destroy();

            return;
        }

        options.handle(request, response).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "the request failed";

            if (!response.headersSent) {
                answer(response, 500, { error: message });
            } else {
                response.end();
            }
        });
    });

    try {
        await new Promise<void>((done, reject) => {
            server.once("error", reject);
            server.listen(options.port, "127.0.0.1", () => {
                server.off("error", reject);
                done();
            });
        });
    } catch (error) {
        await release();

        throw error;
    }

    return {
        onStop: (close) => {
            closers.push(close);
        },
        ready: () => {
            admitting = true;
        },
        stop: () => {
            stopping ??= (async () => {
                admitting = false;

                const closed = new Promise<void>((done) => {
                    server.close(() => {
                        done();
                    });
                });

                // An event stream would keep `server.close()` waiting forever.
                server.closeAllConnections();
                await closed;

                const errors: unknown[] = [];

                for (const close of closers) {
                    try {
                        await close();
                    } catch (error) {
                        errors.push(error);
                    }
                }

                if (errors.length > 0) {
                    throw new AggregateError(errors, "stopping failed; storage may be in use");
                }

                await release();
            })();

            return stopping;
        },
    };
}
