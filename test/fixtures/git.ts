// Git in a temporary folder. `git` overrides the owner's commit identity and turns off commit signing;
// the rest of the owner's global config is still inherited.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export const run = promisify(execFile);

export function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return run(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
        { cwd },
    );
}

/** A repository on `main` with one commit holding `file`, and no other file. */
export async function initRepo(repo: string): Promise<void> {
    await run("git", ["init", "-q", "-b", "main", repo]);
    await git(repo, ["config", "user.name", "t"]);
    await git(repo, ["config", "user.email", "t@t"]);
    await git(repo, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(repo, "file"), "first\n");
    await git(repo, ["add", "file"]);
    await git(repo, ["commit", "-qm", "first"]);
}
