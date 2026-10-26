import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Plugin } from "vite";

// Document metadata and the build-level shell lifecycle (manifest, worker) cannot live in an
// extension's UI slot, so this is the one core piece of the PWA.

const ICONS = [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
const PUBLIC_SHELL = [
    "/favicon.png",
    "/icons/apple-touch-icon.png",
    ...ICONS.map((icon) => icon.src),
];
const STATIC_SHELL = ["/", "/manifest.webmanifest", ...PUBLIC_SHELL];

export interface ShellChunk {
    isEntry: boolean;
    fileName: string;
    imports: string[];
    viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> } | undefined;
}

/** Resolves `--role-<role>` through styles.css to the `--ctp-*` value in one flavour's block. */
export function roleColor(
    stylesCss: string,
    paletteCss: string,
    role: string,
    flavour: string,
): string {
    const palette = /--role-([\w-]+):\s*var\((--ctp-[\w-]+)\)/g;
    const name = [...stylesCss.matchAll(palette)].find((m) => m[1] === role)?.[2];
    const block = paletteCss.match(
        new RegExp(`data-flavour="${flavour}"\\][^{]*\\{([^}]*)\\}`),
    )?.[1];
    const value = name && block?.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]+)`))?.[1];

    if (!value) {
        throw new Error(`pwa: no colour for role "${role}" in flavour "${flavour}"`);
    }

    return value;
}

/** The entry's static import graph with its CSS and assets; lazy chunks stay out. */
export function precacheUrls(chunks: Record<string, ShellChunk>): string[] {
    const urls = new Set(STATIC_SHELL);
    const seen = new Set<string>();
    const visit = (fileName: string): void => {
        const chunk = chunks[fileName];

        if (!chunk || seen.has(fileName)) {
            return;
        }

        seen.add(fileName);
        urls.add(`/${fileName}`);

        for (const file of [
            ...(chunk.viteMetadata?.importedCss ?? []),
            ...(chunk.viteMetadata?.importedAssets ?? []),
        ]) {
            urls.add(`/${file}`);
        }

        chunk.imports.forEach(visit);
    };

    Object.values(chunks)
        .filter((chunk) => chunk.isEntry)
        .forEach((chunk) => visit(chunk.fileName));

    return [...urls].sort();
}

export function shellVersion(parts: (string | Uint8Array)[]): string {
    const hash = createHash("sha256");

    for (const part of parts) {
        hash.update(createHash("sha256").update(part).digest());
    }

    return hash.digest("hex").slice(0, 12);
}

export function renderWorker(template: string, version: string, urls: string[]): string {
    return template
        .replace('"__VERSION__"', JSON.stringify(version))
        .replace('["__PRECACHE__"]', JSON.stringify(urls));
}

export function pwa(): Plugin {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
    const stylesCss = read("./web/src/styles.css");
    const paletteCss = read("./web/src/styles/catppuccin.css");
    // The theme boots in Mocha unless the user picked another flavour (web/src/lib/flavour.ts).
    const colour = (role: string): string => roleColor(stylesCss, paletteCss, role, "mocha");

    return {
        name: "pwa",
        apply: "build",
        enforce: "post",
        transformIndexHtml: () => [
            { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" } },
            { tag: "meta", attrs: { name: "theme-color", content: colour("panel") } },
        ],
        generateBundle(_options, bundle) {
            const chunks: Record<string, ShellChunk> = {};

            for (const [fileName, output] of Object.entries(bundle)) {
                if (output.type === "chunk") {
                    chunks[fileName] = output;
                }
            }

            const manifest = JSON.stringify({
                name: "pi-durable-agent",
                short_name: "pi agent",
                start_url: "/",
                scope: "/",
                display: "standalone",
                background_color: colour("canvas"),
                theme_color: colour("panel"),
                icons: ICONS,
            });
            const template = read("./web/sw.js");
            const urls = precacheUrls(chunks);
            const version = shellVersion([
                template,
                manifest,
                urls.join(),
                ...Object.values(bundle).flatMap((output) =>
                    output.type === "asset" && output.fileName.endsWith(".html")
                        ? [output.source]
                        : [],
                ),
                ...PUBLIC_SHELL.map((file) =>
                    readFileSync(new URL(`./web/public${file}`, import.meta.url)),
                ),
            ]);

            this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
            this.emitFile({
                type: "asset",
                fileName: "sw.js",
                source: renderWorker(template, version, urls),
            });
        },
    };
}
