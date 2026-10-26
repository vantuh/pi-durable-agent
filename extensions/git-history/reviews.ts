/** One explicitly requested, loopback-only Plannotator process per conversation. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

import { ActionError } from "../../server/extensions.ts";
import { readChanges, resolveCommit, rootOf } from "./git.ts";
import type { ReviewState } from "./refs.ts";

export type ReviewJob = {
    session: number;
    view: ReviewState;
    child?: ChildProcess;
    port?: number;
    timer?: ReturnType<typeof setTimeout>;
    stopping?: Promise<void>;
};
const active = (job: ReviewJob) => job.view.state === "starting" || job.view.state === "running";

export class Reviews {
    readonly jobs = new Map<number, ReviewJob>();
    readonly prefix: string;
    readonly command: string;
    readonly env: NodeJS.ProcessEnv;
    constructor(prefix: string, options: { command?: string; env?: NodeJS.ProcessEnv } = {}) {
        this.prefix = prefix;
        this.command = options.command ?? "plannotator";
        this.env = options.env ?? process.env;
    }
    state(session: number): ReviewState | null {
        return this.jobs.get(session)?.view ?? null;
    }
    find(token: string): ReviewJob | undefined {
        return [...this.jobs.values()].find((job) => job.view.id === token && active(job));
    }

    start(session: number, cwd: string, target: string): ReviewState {
        const previous = this.jobs.get(session);
        if (previous !== undefined && active(previous)) {
            if (previous.view.target === target) {
                return previous.view;
            }
            throw new ActionError("Finish or cancel the current review first.");
        }
        if (target !== "worktree" && !/^[0-9a-f]{4,64}$/i.test(target)) {
            throw new ActionError("Choose a commit from the history.");
        }
        const job: ReviewJob = {
            session,
            view: { id: randomBytes(24).toString("hex"), target, state: "starting" },
        };
        this.jobs.set(session, job);
        job.timer = setTimeout(() => {
            void this.fail(job, "Plannotator did not become ready within 45 seconds.");
        }, 45000);
        void this.launch(job, cwd).catch((error: unknown) =>
            this.fail(job, error instanceof Error ? error.message : String(error)),
        );
        return job.view;
    }
    async launch(job: ReviewJob, cwd: string): Promise<void> {
        const root = await rootOf(cwd);
        const work = job.view.target === "worktree";
        let patch: string | undefined;
        if (work) {
            const current = await readChanges(root, "worktree");
            if (current.files.length === 0) {
                throw new ActionError("There is nothing to review.");
            }
        } else {
            const full = await resolveCommit(root, job.view.target);
            const current = await readChanges(root, full, 8 * 1024 * 1024);
            if (current.truncated) {
                throw new ActionError("This patch is too large to send safely (8 MiB limit).");
            }
            if (current.patch.trim() === "") {
                throw new ActionError("This commit has no changes to review.");
            }
            patch = current.patch;
        }
        if (!active(job)) {
            return;
        }
        const args = [
            "review",
            "--json",
            "--no-git-remote-check",
            ...(work ? ["--git", "--diff-type", "uncommitted"] : ["--patch-file", "-"]),
        ];
        const child = spawn(this.command, args, {
            cwd: root,
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...this.env,
                PLANNOTATOR_ORIGIN: "pi",
                PLANNOTATOR_BROWSER: "none",
                PLANNOTATOR_REMOTE: "0",
                PLANNOTATOR_PORT: "",
                PLANNOTATOR_GIT_REMOTE_CHECK: "0",
                PLANNOTATOR_AUTO_UPDATE: "0",
                PLANNOTATOR_UPDATE_CHECK: "0",
                GIT_TERMINAL_PROMPT: "0",
            },
        });
        job.child = child;
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdin?.on("error", () => {
            /* The process may finish before stdin drains. */
        });
        child.stdin?.end(patch ?? "");
        child.stdout?.on("data", (chunk: string) => {
            if (stdout.length + chunk.length > 1024 * 1024) {
                void this.fail(job, "Plannotator returned too much output.");
                return;
            }
            stdout += chunk;
        });
        child.stderr?.on("data", (chunk: string) => {
            stderr = (stderr + chunk).slice(-16000);
            const match =
                /Plannotator session ready:\s*http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(
                    stderr,
                );
            const port = Number(match?.[1]);
            if (job.view.state === "starting" && port > 0 && port <= 65535) {
                job.port = port;
                clearTimeout(job.timer);
                job.view = { ...job.view, state: "running", url: `${this.prefix}/${job.view.id}/` };
                job.timer = setTimeout(
                    () => {
                        void this.fail(
                            job,
                            "Review expired after two hours. Reopen it to continue from saved Plannotator drafts.",
                        );
                    },
                    2 * 60 * 60 * 1000,
                );
            }
        });
        child.once("error", (error: NodeJS.ErrnoException) => {
            void this.fail(
                job,
                error.code === "ENOENT"
                    ? "Plannotator is not installed or is not on the server's PATH."
                    : error.message,
            );
        });
        child.once("close", (code) => {
            if (!active(job)) {
                return;
            }
            clearTimeout(job.timer);
            if (code !== 0) {
                void this.fail(
                    job,
                    stderr.trim().slice(-1500) || `Plannotator exited with code ${String(code)}.`,
                );
                return;
            }
            try {
                const result: unknown = JSON.parse(stdout.trim());
                if (
                    typeof result !== "object" ||
                    result === null ||
                    !("decision" in result) ||
                    !("message" in result) ||
                    typeof result.message !== "string" ||
                    (result.decision !== "approved" &&
                        result.decision !== "annotated" &&
                        result.decision !== "dismissed")
                ) {
                    throw new Error("Plannotator returned an invalid review decision.");
                }
                job.view = {
                    id: job.view.id,
                    target: job.view.target,
                    state: "done",
                    decision: result.decision,
                    message: result.message,
                };
            } catch (error) {
                void this.fail(
                    job,
                    error instanceof Error ? error.message : "Invalid review result.",
                );
            }
        });
    }
    async fail(job: ReviewJob, error: string): Promise<void> {
        if (!active(job)) {
            return;
        }
        job.view = { id: job.view.id, target: job.view.target, state: "failed", error };
        await this.stop(job);
    }
    async cancel(session: number, id: string): Promise<ReviewState | null> {
        const job = this.jobs.get(session);
        if (job === undefined || job.view.id !== id) {
            throw new ActionError("That review is no longer current.");
        }
        if (active(job)) {
            job.view = { id, target: job.view.target, state: "cancelled" };
            await this.stop(job);
        }
        return job.view;
    }
    stop(job: ReviewJob): Promise<void> {
        clearTimeout(job.timer);
        if (job.stopping !== undefined) {
            return job.stopping;
        }
        const child = job.child;
        if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
            return Promise.resolve();
        }
        job.stopping = new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolve();
            }, 2000);
            child.once("close", () => {
                clearTimeout(timer);
                resolve();
            });
            child.kill("SIGTERM");
        });
        return job.stopping;
    }
    async dispose(): Promise<void> {
        await Promise.all(
            [...this.jobs.values()].map(async (job) => {
                if (active(job)) {
                    job.view = { id: job.view.id, target: job.view.target, state: "cancelled" };
                }
                await this.stop(job);
            }),
        );
        this.jobs.clear();
    }
}
