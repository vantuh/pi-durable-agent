import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

import "./file-tree.css";

const { resolveIcon } = createFileTreeIconResolver("complete");
const SPRITE = "git-history-file-icons";

// Diff headers live outside the tree's shadow root, so they need one document-level sprite.
if (document.getElementById(SPRITE) === null) {
    const sprite = document.createElement("div");
    sprite.id = SPRITE;
    sprite.hidden = true;
    sprite.innerHTML = getBuiltInSpriteSheet("complete");
    document.body.append(sprite);
}

/** The same built-in file shapes and per-type colors as the tree. */
export function FileMark({ name }: { name: string }) {
    const icon = resolveIcon("file-tree-icon-file", name);
    return (
        <svg
            aria-hidden="true"
            className="git-history-file-icon size-4 shrink-0"
            data-icon-token={icon.token}
            viewBox="0 0 16 16"
        >
            <use href={`#${icon.name}`} />
        </svg>
    );
}
