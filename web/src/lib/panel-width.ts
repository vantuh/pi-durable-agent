const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 1100;

/** The panel shrinks on its own when the row is short: the conversation keeps 320px (see App.tsx). */
export function clampPanelWidth(wanted: number): number {
    return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, wanted)));
}
