import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

/**
 * The environment each conversation runs its tools in: its own folder, so `bash`, `read` and `edit`
 * work where the session is. `fallback` is the process's folder, for a conversation that has none.
 *
 * The harness passes the conversation's `cwd` in; this must not be a callback that ignores it, or
 * every session would work in the app's own folder, a worktree among them.
 */
export function executionEnv(fallback: string) {
    return ({ cwd }: { cwd?: string | undefined }): NodeExecutionEnv =>
        new NodeExecutionEnv({ cwd: cwd ?? fallback });
}
