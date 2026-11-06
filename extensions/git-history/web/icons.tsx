import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

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

/** The same built-in file shapes as the tree, without its per-type colors. */
export function FileMark({ name }: { name: string }) {
    const icon = resolveIcon("file-tree-icon-file", name);
    return (
        <svg aria-hidden="true" className="text-muted size-4 shrink-0" viewBox="0 0 16 16">
            <use href={`#${icon.name}`} />
        </svg>
    );
}
