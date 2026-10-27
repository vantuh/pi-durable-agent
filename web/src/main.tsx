import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { applyFlavour, currentFlavour } from "./lib/flavour.ts";
import { registerWorker } from "./lib/register-worker.ts";
import { applyWidth, currentWidth } from "./lib/width.ts";

import "./styles.css";

applyFlavour(currentFlavour());
applyWidth(currentWidth());
registerWorker();

const root = document.getElementById("root");

if (!root) {
    throw new Error("no #root element");
}

createRoot(root).render(
    <StrictMode>
        <App />
        <Toaster />
    </StrictMode>,
);
