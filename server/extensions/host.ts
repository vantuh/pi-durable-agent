/**
 * The host one extension version is handed: the core's services under the folder's name, and the calls that
 * register something with that version (a listener, a shaper, a mark). What a call registers is collected for the
 * loader, which installs it together with the version or drops it with it.
 */

import type { ExtensionNotice } from "../../shared/protocol.ts";
import type { FetchWrapper, RequestShaper } from "../model-requests.ts";
import type {
    CommitListener,
    Disposer,
    FolderGroup,
    Host,
    SessionGoneListener,
} from "./contract.ts";

/** What the core lends every extension version; the same functions reach each folder. */
export type HostServices = Pick<
    Host,
    | "resolveModelAuth"
    | "registerModelProvider"
    | "contextWindow"
    | "sessionRequest"
    | "sessionPrompt"
    | "sessionContext"
    | "sessionTitle"
    | "sessionName"
    | "sessionOwner"
    | "sessionSeen"
    | "sessionWorking"
    | "setSessionTitle"
    | "setSessionCwd"
    | "readDoc"
> & {
    readonly notify: (notice: ExtensionNotice) => void;
    /** The session list has to be read again. */
    readonly sessionListChanged: () => void;
    readonly sessionChanged: (session: number) => void;
};

/** The services, with a stand-in for each one the caller gave none of: a test lends only what it uses. */
export function hostServices(options: Partial<HostServices>): HostServices {
    return {
        notify: options.notify ?? (() => undefined),
        resolveModelAuth: options.resolveModelAuth ?? (() => Promise.resolve(undefined)),
        registerModelProvider: options.registerModelProvider ?? (() => () => undefined),
        contextWindow: options.contextWindow ?? (() => undefined),
        sessionRequest: options.sessionRequest ?? (() => Promise.resolve(undefined)),
        sessionPrompt: options.sessionPrompt ?? (() => Promise.resolve(undefined)),
        sessionContext: options.sessionContext ?? (() => Promise.resolve(undefined)),
        sessionTitle: options.sessionTitle ?? (() => Promise.resolve(null)),
        sessionName: options.sessionName ?? (() => Promise.resolve(null)),
        sessionOwner: options.sessionOwner ?? (() => Promise.resolve(undefined)),
        sessionSeen: options.sessionSeen ?? (() => Promise.resolve(false)),
        sessionWorking: options.sessionWorking ?? (() => Promise.resolve(false)),
        setSessionTitle: options.setSessionTitle ?? (() => Promise.resolve()),
        setSessionCwd: options.setSessionCwd ?? (() => Promise.resolve()),
        readDoc: options.readDoc ?? ((doc) => Promise.resolve(doc.definition.initial())),
        sessionListChanged: options.sessionListChanged ?? (() => undefined),
        sessionChanged: options.sessionChanged ?? (() => undefined),
    };
}

/** What a build of one folder collects while its default export runs. */
export type Registrations = {
    readonly disposers: Disposer[];
    readonly commits: CommitListener[];
    readonly gone: SessionGoneListener[];
    readonly groups: FolderGroup[];
    /** Run when the version is installed, in the same tick, never while it is only built. */
    readonly activations: (() => void)[];
};

/** The loader's state that a host call writes to or reads, shared by every folder. */
export type SharedState = {
    /** Per folder, the marks its live version put on session rows. */
    readonly marks: Map<string, Map<number, string>>;
    readonly shapers: Set<RequestShaper>;
    readonly fetchWrappers: Set<FetchWrapper>;
    readonly toolOwner: Host["toolOwner"];
};

export function createHost(options: {
    folder: string;
    cwd: string;
    dataDir: string;
    log: (message: string) => void;
    services: HostServices;
    shared: SharedState;
    registrations: Registrations;
}): Host {
    const { folder, services, shared, registrations } = options;

    return {
        name: folder,
        cwd: options.cwd,
        dataDir: options.dataDir,
        log: options.log,
        onDispose: (dispose) => {
            registrations.disposers.push(dispose);
        },
        resolveModelAuth: services.resolveModelAuth,
        contextWindow: services.contextWindow,
        toolOwner: shared.toolOwner,
        sessionRequest: (session) => services.sessionRequest(session),
        sessionPrompt: (session) => services.sessionPrompt(session),
        sessionContext: (session) => services.sessionContext(session),
        sessionTitle: (session) => services.sessionTitle(session),
        sessionName: (session) => services.sessionName(session),
        sessionOwner: (session) => services.sessionOwner(session),
        sessionSeen: (session) => services.sessionSeen(session),
        sessionWorking: (session) => services.sessionWorking(session),
        setSessionTitle: (session, title) => services.setSessionTitle(session, title),
        setSessionCwd: (session, cwd) => services.setSessionCwd(session, cwd),
        readDoc: (doc, session) => services.readDoc(doc, session),
        setSessionMark: (session, mark) => {
            const marks = shared.marks.get(folder) ?? new Map<number, string>();

            shared.marks.set(folder, marks);
            if (mark === undefined) {
                marks.delete(session);
            } else {
                marks.set(session, mark);
            }
            services.sessionListChanged();
        },
        notifySessionChanged: (session) => {
            services.sessionChanged(session);
        },
        // The loader's own channel: an extension's notice reaches the browsers the same way a load does.
        notify: (notice) => {
            services.notify(notice);
        },
        wrapModelFetch: (wrap) => {
            registrations.activations.push(() => {
                shared.fetchWrappers.add(wrap);
            });
            registrations.disposers.push(() => {
                shared.fetchWrappers.delete(wrap);
            });
        },
        registerModelProvider: (provider) => {
            let unregister: (() => void) | undefined;
            let stopped = false;

            // Registered on install, not here: a build that throws must leave the live one in place.
            registrations.activations.push(() => {
                if (!stopped) {
                    unregister = services.registerModelProvider(provider);
                }
            });

            const stop = (): void => {
                stopped = true;
                unregister?.();
                unregister = undefined;
            };

            registrations.disposers.push(stop);

            return stop;
        },
        shapeModelRequests: (shape) => {
            registrations.activations.push(() => {
                shared.shapers.add(shape);
            });
            registrations.disposers.push(() => {
                shared.shapers.delete(shape);
            });
        },
        onCommit: (listener) => {
            registrations.commits.push(listener);
        },
        onSessionGone: (listener) => {
            registrations.gone.push(listener);
        },
        folderGroup: (resolve) => {
            registrations.groups.push(resolve);
        },
    };
}
