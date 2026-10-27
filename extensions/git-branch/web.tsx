import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { branch } from "./refs.ts";

function useBranch(session: StatusProps["session"]): string | null {
    const [name, setName] = useState<string | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        let alive = true;

        void (async () => {
            let found: string | null = null;

            try {
                found = await callAction(branch, undefined, id);
            } catch {
                found = null;
            }

            if (alive) {
                setName(found);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new folder, or a run ending (busy going false), can change the branch
    }, [id, cwd, busy]);

    return name;
}

function Branch({ session }: StatusProps) {
    const name = useBranch(session);

    if (name === null) {
        return null;
    }

    return (
        <Badge title={`Branch ${name}`} className="hidden max-w-40 sm:inline-flex">
            <GitBranch />
            <span className="truncate">{name}</span>
        </Badge>
    );
}

export default {
    status: [{ id: "branch", slot: "title", component: Branch }],
} satisfies WebExtension;
