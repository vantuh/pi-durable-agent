import { memo } from "react";

import { sameTurn } from "@/lib/turn-equality.ts";
import type { Turn } from "@/lib/turns.ts";

import { AgentMessage } from "../agent-message.tsx";
import { CompactionMark } from "../compaction/compaction-mark.tsx";
import { AnswerHeader } from "./answer-header.tsx";
import { TurnItem } from "./turn-item.tsx";
import { UserMessage } from "./user-message.tsx";

/**
 * One turn. It renders again only when it shows something new: a chunk of a streamed answer rebuilds every turn of the
 * transcript, and only the turn at the end differs. `onOpenSession` comes from `useRoute`'s own `useCallback`.
 */
export const TurnView = memo(
    function TurnView({
        turn,
        onOpenSession,
    }: {
        turn: Turn;
        onOpenSession: (session: number) => void;
    }) {
        return (
            <div className="flex flex-col gap-3">
                {turn.compacted === undefined ? null : <CompactionMark {...turn.compacted} />}
                {turn.user?.author === undefined ? null : (
                    <AgentMessage
                        text={turn.user.text}
                        author={turn.user.author}
                        onOpenSession={onOpenSession}
                    />
                )}
                {turn.user === undefined || turn.user.author !== undefined ? null : (
                    <UserMessage user={turn.user} />
                )}
                {turn.items.length === 0 && !turn.live ? null : (
                    <div className="flex flex-col gap-2.5">
                        {turn.stats === undefined && !turn.live ? null : (
                            <AnswerHeader turn={turn} />
                        )}
                        {turn.items.map((item) => (
                            <TurnItem key={item.key} item={item} />
                        ))}
                    </div>
                )}
            </div>
        );
    },
    (before, after) =>
        before.onOpenSession === after.onOpenSession && sameTurn(before.turn, after.turn),
);
