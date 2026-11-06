export interface TreeFile {
    id: string;
    path: string;
    added: number;
    deleted: number;
}

export function treeFiles(files: TreeFile[]): Map<string, TreeFile> {
    const occupied = new Set(files.map((file) => file.path));
    return new Map(
        files.map((file) => {
            let path = file.path;
            // Git can replace a file with a directory in one diff; Trees cannot share their path.
            while (
                files.some((other) => other.path.startsWith(`${path}/`)) ||
                (path !== file.path && occupied.has(path))
            ) {
                path += " (file)";
            }
            occupied.add(path);
            return [path, file];
        }),
    );
}

/** The order the file tree shows: folders before files, dot names first, then names without case. */
export function treeOrder(left: string, right: string): number {
    const a = left.split("/");
    const b = right.split("/");
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const [x = "", y = ""] = [a[i], b[i]];
        const xDir = i < a.length - 1;
        const yDir = i < b.length - 1;
        if (xDir !== yDir) {
            return xDir ? -1 : 1;
        }
        const xDot = x.startsWith(".");
        if (xDot !== y.startsWith(".")) {
            return xDot ? -1 : 1;
        }
        const order = x.toLowerCase().localeCompare(y.toLowerCase());
        if (order !== 0) {
            return order;
        }
    }
    return a.length - b.length;
}
