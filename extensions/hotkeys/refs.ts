import { actionRef } from "../../shared/extension-api.ts";
import { mergeKeymap, type Keymap } from "./lib.ts";

/** The key bindings in force: the defaults with `data/hotkeys.json` laid over them. */
export const keymap = actionRef<undefined, Keymap>("hotkeys", "keymap", mergeKeymap);
