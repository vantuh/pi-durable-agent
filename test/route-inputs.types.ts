// Checked by `tsc`, never run: what the typed client may leave out. A route that accepts a request without a
// field must not make `hc` demand it, so each line sends the least a route takes. A line that stops compiling
// means a schema made an optional field required in `z.input`.
import { hc } from "hono/client";

import type { mountRoutes } from "../server/app.ts";

const client = hc<ReturnType<typeof mountRoutes>>("");

type Input<Call> = Call extends (...args: infer Args) => unknown ? Args[0] : never;

export const leastInputs: {
    createSession: Input<typeof client.api.sessions.$post>;
    archive: Input<typeof client.api.sessions.archive.$post>;
    deleteSession: Input<typeof client.api.sessions.delete.$post>;
    title: Input<typeof client.api.sessions.title.$post>;
    seen: Input<typeof client.api.sessions.seen.$post>;
    scope: Input<typeof client.api.scoped.$post>;
    unscope: Input<typeof client.api.scoped.$delete>;
    setDefault: Input<typeof client.api.default.$post>;
    favourites: Input<typeof client.api.favourites.$put>;
    folderLayout: Input<(typeof client.api)["folder-layout"]["$put"]>;
    folders: Input<typeof client.api.fs.$get>;
    upload: Input<typeof client.api.uploads.$get>;
    events: Input<typeof client.api.events.$get>;
    history: Input<typeof client.api.history.$get>;
    entryImage: Input<(typeof client.api)["entry-image"]["$get"]>;
    message: Input<typeof client.api.messages.$post>;
    withdraw: Input<typeof client.api.queued.withdraw.$post>;
    abort: Input<typeof client.api.abort.$post>;
    agent: Input<typeof client.api.agent.$post>;
    command: Input<typeof client.api.commands.$post>;
    skills: Input<typeof client.api.skills.$get>;
    projectFiles: Input<(typeof client.api)["project-files"]["$get"]>;
    action: Input<(typeof client.api.extensions)[":name"]["actions"][":action"]["$post"]>;
    toggle: Input<(typeof client.api.extensions)[":name"]["$put"]>;
} = {
    createSession: { json: {} },
    archive: { json: { session: 1, archived: true } },
    deleteSession: { json: { session: 1 } },
    title: { json: { session: 1, title: "x" } },
    seen: { json: { session: 1 } },
    scope: { json: { provider: "p", modelId: "m" } },
    unscope: { json: { provider: "p", modelId: "m" } },
    setDefault: { json: { model: { provider: "p", modelId: "m" }, thinkingLevel: "off" } },
    favourites: { json: {} },
    folderLayout: { json: {} },
    folders: { query: {} },
    upload: { query: {} },
    events: { query: {} },
    history: { query: {} },
    entryImage: { query: { session: "1", entry: "2" } },
    message: { json: {} },
    withdraw: { json: { id: 3 } },
    abort: { json: {} },
    agent: { json: {} },
    command: { json: {} },
    skills: { query: {} },
    projectFiles: { query: {} },
    action: { param: { name: "a", action: "b" }, json: {} },
    toggle: { param: { name: "a" }, json: { enabled: true } },
};

// @ts-expect-error a title needs its session
export const noSession: Input<typeof client.api.sessions.title.$post> = { json: { title: "x" } };
