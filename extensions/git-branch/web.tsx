import { FolderGit2, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { branch, type Checkout } from "./refs.ts";

const BADGE = "hidden h-4 max-w-full min-w-0 shrink px-1.5 sm:inline-flex [&>svg]:size-2.5";

function useCheckout(session: StatusProps["session"]): Checkout | null {
    const [checkout, setCheckout] = useState<Checkout | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        let alive = true;

        void (async () => {
            let found: Checkout | null = null;

            try {
                found = await callAction(branch, undefined, id);
            } catch {
                found = null;
            }

            if (alive) {
                setCheckout(found);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new folder, or a run ending (busy going false), can change the branch
    }, [id, cwd, busy]);

    return checkout;
}

function Branch({ session }: StatusProps) {
    const checkout = useCheckout(session);

    if (checkout === null) {
        return null;
    }

    return (
        <>
            <Badge title={`Branch ${checkout.branch}`} className={BADGE}>
                <GitBranch />
                <span className="truncate">{checkout.branch}</span>
            </Badge>
            {checkout.worktree === null ? null : (
                <Badge title={`Worktree ${checkout.worktree}`} className={BADGE}>
                    <FolderGit2 />
                    <span className="truncate">{checkout.worktree}</span>
                </Badge>
            )}
        </>
    );
}

export default {
    status: [{ id: "branch", slot: "title", component: Branch }],
} satisfies WebExtension;
