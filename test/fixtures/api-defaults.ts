// What a fake server in a browser test answers to a route the test is not about. The typed client trusts the shape
// of every answer, so each is the real shape of its route, empty; `{}` would leave the shell waiting or crashing.
const EMPTY: Record<string, unknown> = {
    "/api/extensions": { installed: [], failed: [], extensions: [] },
    "/api/skills": { skills: [] },
    "/api/project-files": { files: [] },
    "/api/favourites": { folders: [] },
    "/api/models": {
        scoped: [],
        all: [],
        default: { provider: "faux", modelId: "m1", thinkingLevel: "off" },
    },
};

export function defaultAnswer(pathname: string): unknown {
    return EMPTY[pathname] ?? {};
}
