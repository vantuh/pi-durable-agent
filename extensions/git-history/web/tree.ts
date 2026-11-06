export interface TreeFile {
    id: string;
    path: string;
    added: number;
    deleted: number;
}

export interface TreeBranch {
    name: string;
    path: string;
    folders: TreeBranch[];
    file?: TreeFile;
}

/** Paths as folders and names: a folder keeps its path, a file leaf keeps its id. */
export function treeOf(files: TreeFile[]): TreeBranch[] {
    const root: TreeBranch = { name: "", path: "", folders: [] };
    for (const file of files) {
        const parts = file.path.split("/");
        let node = root;
        for (const [at, name] of parts.entries()) {
            const path = parts.slice(0, at + 1).join("/");
            let next = node.folders.find((each) => each.name === name);
            if (next === undefined) {
                next = { name, path, folders: [] };
                node.folders.push(next);
            }
            node = next;
        }
        node.file = file;
    }
    const ordered = (branches: TreeBranch[]): TreeBranch[] =>
        branches
            .map((branch) => ({ ...branch, folders: ordered(branch.folders) }))
            // Folders first, then files; each by name.
            .sort(
                (left, right) =>
                    Number(left.file !== undefined) - Number(right.file !== undefined) ||
                    left.name.localeCompare(right.name),
            );
    return ordered(root.folders);
}
