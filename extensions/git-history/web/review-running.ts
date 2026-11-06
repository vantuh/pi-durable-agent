import type { ReviewState } from "../refs.ts";

export const reviewRunning = (value: ReviewState | null) =>
    value?.state === "starting" || value?.state === "running";
