// A full `Host` for extension tests: every member does nothing. A test passes only what it reads or records.
// When `Host` gains a member, this is the one place that has to learn it.
import type { Host } from "../../server/sdk.ts";

export function testHost(overrides: Partial<Host> = {}): Host {
    return {
        name: "test",
        cwd: ".",
        dataDir: ".",
        log: () => undefined,
        onDispose: () => undefined,
        onCommit: () => undefined,
        folderGroup: () => undefined,
        shapeModelRequests: () => undefined,
        wrapModelFetch: () => undefined,
        registerModelProvider: () => () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        toolOwner: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        sessionOwner: () => Promise.resolve(undefined),
        sessionSeen: () => Promise.resolve(false),
        setSessionTitle: () => Promise.resolve(),
        readDoc: (doc) => Promise.resolve(doc.definition.initial()),
        setSessionMark: () => undefined,
        notifySessionChanged: () => undefined,
        notify: () => undefined,
        ...overrides,
    };
}
