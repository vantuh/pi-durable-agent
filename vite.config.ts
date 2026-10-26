import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    root: "web",
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./web/src", import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:8788",
        },
    },
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
});
