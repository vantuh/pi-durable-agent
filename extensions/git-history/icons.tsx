import { cn } from "@/lib/utils";

import iconsUrl from "./icons.woff2?url";

/**
 * The marks are Nerd Font glyphs, the 27 below (6.6 KB), subsetted from the JetBrains Mono Nerd
 * Font a terminal uses: the same pictures an editor shows, without an icon package. Regenerate
 * with the command in docs/git-history.md when a new kind of file needs a mark.
 */
const FONT = "git-history-icons";

if (document.querySelector(`style[data-font="${FONT}"]`) === null) {
    const style = document.createElement("style");
    style.setAttribute("data-font", FONT);
    style.textContent = `@font-face {
    font-family: "${FONT}";
    src: url("${iconsUrl}") format("woff2");
    font-display: block;
}
.${FONT} {
    font-family: "${FONT}";
    font-size: 1.15em;
    line-height: 1;
}`;
    document.head.append(style);
}

const GLYPH = {
    typescript: "\ue628",
    javascript: "\ue60c",
    react: "\ue625",
    markdown: "\ue73e",
    text: "\ue64e",
    json: "\ueb0f",
    config: "\ue615",
    yaml: "\ue8eb",
    lock: "\ue672",
    css: "\ue614",
    html: "\ue60e",
    shell: "\ue691",
    database: "\ue706",
    image: "\ue60d",
    svg: "\ue698",
    vue: "\ue6a0",
    python: "\ue606",
    go: "\ue724",
    rust: "\ue68b",
    java: "\ue66d",
    php: "\ue608",
    ruby: "\ue605",
    swift: "\ue699",
    kotlin: "\ue634",
    lua: "\ue620",
    docker: "\ue650",
    license: "\u{f0fc3}",
} as const;

type Mark = { glyph: string; tone: string };

const code: Mark = { glyph: GLYPH.typescript, tone: "text-info" };
const script: Mark = { glyph: GLYPH.javascript, tone: "text-warn" };
const component: Mark = { glyph: GLYPH.react, tone: "text-agent" };
const style: Mark = { glyph: GLYPH.css, tone: "text-accent" };
const markup: Mark = { glyph: GLYPH.html, tone: "text-ember" };
const shell: Mark = { glyph: GLYPH.shell, tone: "text-ok" };
const media: Mark = { glyph: GLYPH.image, tone: "text-accent" };
const docs: Mark = { glyph: GLYPH.markdown, tone: "text-muted" };
const plain: Mark = { glyph: GLYPH.text, tone: "text-faint" };
const licence: Mark = { glyph: GLYPH.license, tone: "text-muted" };
const docker: Mark = { glyph: GLYPH.docker, tone: "text-info" };

/** The mark belongs to the kind of file; the name and the counts carry the rest. */
const BY_EXTENSION: Record<string, Mark> = {
    ts: code,
    mts: code,
    cts: code,
    tsx: component,
    jsx: component,
    vue: component,
    js: script,
    mjs: script,
    cjs: script,
    json: script,
    css: style,
    scss: style,
    sass: style,
    less: style,
    html: markup,
    htm: markup,
    sh: shell,
    bash: shell,
    zsh: shell,
    fish: shell,
    yml: { glyph: GLYPH.yaml, tone: "text-spark" },
    yaml: { glyph: GLYPH.yaml, tone: "text-spark" },
    toml: { glyph: GLYPH.config, tone: "text-spark" },
    ini: { glyph: GLYPH.config, tone: "text-spark" },
    conf: { glyph: GLYPH.config, tone: "text-spark" },
    cfg: { glyph: GLYPH.config, tone: "text-spark" },
    env: { glyph: GLYPH.config, tone: "text-spark" },
    lock: { glyph: GLYPH.lock, tone: "text-spark" },
    sql: { glyph: GLYPH.database, tone: "text-ember" },
    db: { glyph: GLYPH.database, tone: "text-ember" },
    sqlite: { glyph: GLYPH.database, tone: "text-ember" },
    svg: { glyph: GLYPH.svg, tone: "text-accent" },
    png: media,
    jpg: media,
    jpeg: media,
    gif: media,
    webp: media,
    avif: media,
    ico: media,
    md: docs,
    mdx: docs,
    txt: plain,
    log: plain,
    py: { glyph: GLYPH.python, tone: "text-info" },
    go: { glyph: GLYPH.go, tone: "text-info" },
    lua: { glyph: GLYPH.lua, tone: "text-info" },
    rs: { glyph: GLYPH.rust, tone: "text-ember" },
    java: { glyph: GLYPH.java, tone: "text-ember" },
    swift: { glyph: GLYPH.swift, tone: "text-ember" },
    kt: { glyph: GLYPH.kotlin, tone: "text-accent" },
    php: { glyph: GLYPH.php, tone: "text-muted" },
    rb: { glyph: GLYPH.ruby, tone: "text-danger" },
};

function markOf(fileName: string): Mark {
    const name = fileName.toLowerCase();
    // A licence is a licence whatever follows the name, and a Dockerfile has no extension to read.
    if (name.startsWith("licen")) {
        return licence;
    }
    if (name.startsWith("dockerfile")) {
        return docker;
    }
    const extension = name.slice(name.lastIndexOf(".") + 1);

    return BY_EXTENSION[extension] ?? plain;
}

/** One file's mark, the same in the tree and in the diff header. */
export function FileMark({ name }: { name: string }) {
    const mark = markOf(name);

    return (
        <span aria-hidden="true" className={cn(FONT, mark.tone, "shrink-0")}>
            {mark.glyph}
        </span>
    );
}
