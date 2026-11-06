import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { cost, formatDuration, tokens } from "@/lib/format.ts";
import type { Turn } from "@/lib/turns.ts";

import { useNow } from "../use-now.ts";

/**
 * The answer's statistics, above it: model and thinking level, then context, output, cost and time. Context is the
 * newest response's prompt; output and cost add up every response of the turn. Its hint says it in full.
 */
export function AnswerHeader({ turn }: { turn: Turn }) {
    const now = useNow(turn.live);
    const stats = turn.stats;
    const startedAt = stats?.startedAt ?? turn.user?.at;
    const until = turn.live ? now : stats?.endedAt;
    const time = startedAt === undefined || until === undefined ? undefined : until - startedAt;
    // Nothing cached is the common case for a first answer; the marker is worth the room only when it says something.
    const cachedPercent =
        stats === undefined || stats.context <= 0 || stats.cached <= 0
            ? undefined
            : Math.round((stats.cached / stats.context) * 100);
    const spend =
        stats === undefined
            ? []
            : [
                  ...(cachedPercent === undefined ? [] : [`↻${String(cachedPercent)}%`]),
                  `↑${tokens(stats.context)} ↓${tokens(stats.output)}`,
                  ...(stats.cost > 0 ? [cost(stats.cost)] : []),
              ];
    const hint =
        stats === undefined
            ? undefined
            : [
                  `${String(stats.responses)} ${stats.responses === 1 ? "response" : "responses"}`,
                  `context ${stats.context.toLocaleString()} tokens`,
                  ...(cachedPercent === undefined
                      ? []
                      : [
                            `${String(cachedPercent)}% of it came from the cache (${stats.cached.toLocaleString()} tokens)`,
                        ]),
                  `output ${stats.output.toLocaleString()} tokens`,
                  ...(stats.cost > 0 ? [`cost ${cost(stats.cost)}`] : []),
              ].join(" · ");

    const row = (
        <div className="text-meta text-faint flex min-w-0 items-center gap-2 font-mono">
            {turn.live ? <Spinner className="size-3 shrink-0" /> : null}
            <span className="text-muted truncate">
                {stats === undefined ? "working" : stats.model}
                {stats?.thinkingLevel === undefined ? "" : ` · ${stats.thinkingLevel}`}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
                {[...spend, ...(time === undefined ? [] : [formatDuration(time)])].join(" · ")}
            </span>
        </div>
    );

    return hint === undefined ? row : <Hint label={hint}>{row}</Hint>;
}
