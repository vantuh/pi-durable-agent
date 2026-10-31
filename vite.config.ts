import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath } from "vite";

import { pwa } from "./pwa.ts";

const extensionsDir = normalizePath(fileURLToPath(new URL("./extensions", import.meta.url)));

export default defineConfig({
    root: "web",
    plugins: [
        react(),
        tailwindcss(),
        pwa(),
        {
            // Vite's root is web/, so a new extensions/<folder>/web.tsx would not reach the glob.
            name: "watch-extensions",
            configureServer(server) {
                server.watcher.add(extensionsDir);
            },
            // A deleted file that the page loaded gets an HMR update that fetches it (404), and the
            // item list would stay stale, so the page reloads instead.
            hotUpdate({ type, file, modules }) {
                if (
                    this.environment.name !== "client" ||
                    type !== "delete" ||
                    modules.length === 0 ||
                    !normalizePath(file).startsWith(`${extensionsDir}/`)
                ) {
                    return undefined;
                }

                this.environment.hot.send({ type: "full-reload", path: "*" });

                return [];
            },
        },
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./web/src", import.meta.url)),
        },
    },
    server: {
        port: 5190,
        strictPort: true,
        proxy: {
            "/api": { target: "http://127.0.0.1:8788", changeOrigin: false },
        },
    },
    build: {
        outDir: "../dist",
        emptyOutDir: true,
        rolldownOptions: {
            output: {
                // Vendor code is not app code: in the entry chunk, every edit to the app re-ships all of
                // it. Split the eager vendor code instead, so the entry is the size of our own code.
                // `$initial` keeps lazy chunks — shiki grammars, @pierre/diffs — as they are: each is named
                // after what it holds and fetched only when a code block or a diff needs it.
                codeSplitting: {
                    groups: [
                        {
                            name: "react",
                            test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                            tags: ["$initial"],
                        },
                        { name: "vendor", test: /node_modules[\\/]/, tags: ["$initial"] },
                    ],
                },
            },
        },
    },
});
