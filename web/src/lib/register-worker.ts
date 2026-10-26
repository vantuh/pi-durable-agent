// Production only: in dev a worker would serve stale modules over Vite's HMR.
export function registerWorker(): void {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
        return;
    }

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
            console.warn("service worker not registered", error);
        });
    });
}
