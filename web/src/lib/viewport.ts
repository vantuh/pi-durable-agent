/**
 * iOS and iPadOS do not shrink the layout viewport when the on-screen keyboard opens; they scroll
 * the page instead, which pushes the header out of view. Pin the app to the visual viewport, in
 * height and offset, so it stays on the visible area while the keyboard slides in.
 */
export function followVisualViewport(): void {
    const viewport = window.visualViewport;

    if (!viewport) {
        return;
    }

    const apply = () => {
        document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
        document.documentElement.style.setProperty("--app-top", `${viewport.offsetTop}px`);
    };

    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    apply();
}
