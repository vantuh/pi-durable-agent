import { useState } from "react";
import { createRoot } from "react-dom/client";

import { FileTree } from "../file-tree.tsx";
import type { TreeFile } from "../tree.ts";

import "@/styles/styles.css";

function TreePage() {
    const [files, setFiles] = useState<TreeFile[]>([
        { id: "component", path: "src/demo.tsx", added: 12, deleted: 3 },
        { id: "readme", path: "README.md", added: 0, deleted: 0 },
    ]);
    const [picks, setPicks] = useState<string[]>([]);
    Object.assign(window, { replaceTreeFiles: setFiles });
    return (
        <main className="bg-panel flex h-full w-60 flex-col">
            <output>{JSON.stringify(picks)}</output>
            <FileTree
                files={files}
                onPick={(file) => {
                    setPicks((old) => [...old, file.id]);
                }}
            />
        </main>
    );
}

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Missing tree fixture root");
}
createRoot(root).render(<TreePage />);
