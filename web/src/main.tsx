import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { applyFlavour, currentFlavour } from "./lib/flavour.ts";

import "./styles.css";

applyFlavour(currentFlavour());

const root = document.getElementById("root");

if (!root) {
    throw new Error("no #root element");
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
