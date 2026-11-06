import type { SendMode } from "../../../../shared/protocol.ts";

export type ModeOption = { mode: SendMode; label: string; hint: string };

export const MODES: ModeOption[] = [
    { mode: "steer", label: "Steer", hint: "read after the current step" },
    { mode: "followUp", label: "Queue", hint: "read when this run ends" },
    { mode: "interrupt", label: "Interrupt", hint: "stop the run now, then send" },
];
