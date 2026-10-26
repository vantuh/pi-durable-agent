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
            "/api": "http://127.0.0.1:8788",
        },
    },
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
});
