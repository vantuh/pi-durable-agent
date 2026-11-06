import type { StatusProps } from "@/sdk/types.ts";

import { Mark } from "./mark.tsx";

/** Keyed by session: a reply that lands after the person moved to another conversation is that one's. */
export function SessionMark(props: StatusProps) {
    return <Mark key={props.session?.id} {...props} />;
}
