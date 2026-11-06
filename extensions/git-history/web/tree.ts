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
