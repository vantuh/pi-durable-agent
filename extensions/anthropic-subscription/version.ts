/** Numeric semver ordering, not lexical ordering (2.1.99 < 2.1.280). */
export function higherVersion(left: string, right: string | undefined): string {
    if (right === undefined || !/^\d+\.\d+\.\d+$/.test(right)) {
        return left;
    }
    const a = left.split(".").map(BigInt);
    const b = right.split(".").map(BigInt);
    for (let i = 0; i < 3; i += 1) {
        if ((b[i] ?? 0n) > (a[i] ?? 0n)) {
            return right;
        }
        if ((b[i] ?? 0n) < (a[i] ?? 0n)) {
            return left;
        }
    }
    return left;
}

export function cliVersion(request: Request): string | undefined {
    return /^claude-cli\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(
        request.headers.get("user-agent") ?? "",
    )?.[1];
}
