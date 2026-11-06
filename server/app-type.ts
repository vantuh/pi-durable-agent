/** The one thing of `server/` the browser may name, for `hc`: it imports it with `import type`, and nothing else. */

import type { mountRoutes } from "./app.ts";

export type AppType = ReturnType<typeof mountRoutes>;
