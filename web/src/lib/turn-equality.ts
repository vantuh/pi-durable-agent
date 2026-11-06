import type { Item, Step, Turn, TurnStats, ToolStep } from "./turns.ts";

type ThinkingStep = Extract<Step, { kind: "thinking" }>;
type ActivityItem = Extract<Item, { type: "activity" }>;
type ReplyItem = Extract<Item, { type: "reply" }>;
type ErrorItem = Extract<Item, { type: "error" }>;

/**
 * Every field of `T` compared, as one comparison. `same` has to name each key of `T`, so a field added to one of the types
 * above and left out here fails to compile: the memo would otherwise keep the screen showing its old value.
 */
function comparing<T>(
    same: Record<keyof T, (one: T, other: T) => boolean>,
): (one: T, other: T) => boolean {
    const fields: ((one: T, other: T) => boolean)[] = [];

    for (const key in same) {
        fields.push(same[key]);
    }

    return (one, other) => {
        for (const field of fields) {
            if (!field(one, other)) {
                return false;
            }
        }

        return true;
    };
}

/** Two lists of the same kind — a group's steps, a turn's items — compared entry by entry. */
const sameList = <T>(one: T[], other: T[], same: (one: T, other: T) => boolean): boolean =>
    one.length === other.length &&
    one.every((item, at) => {
        const otherItem = other[at];

        return otherItem !== undefined && same(item, otherItem);
    });

const sameThinking = comparing<ThinkingStep>({
    kind: (one, other) => one.kind === other.kind,
    key: (one, other) => one.key === other.key,
    text: (one, other) => one.text === other.text,
    streaming: (one, other) => one.streaming === other.streaming,
});

const sameTool = comparing<ToolStep>({
    kind: (one, other) => one.kind === other.kind,
    key: (one, other) => one.key === other.key,
    id: (one, other) => one.id === other.id,
    name: (one, other) => one.name === other.name,
    args: (one, other) => one.args === other.args,
    status: (one, other) => one.status === other.status,
    result: (one, other) => one.result === other.result,
});

const sameStep = (one: Step, other: Step): boolean =>
    one.kind === "thinking"
        ? other.kind === "thinking" && sameThinking(one, other)
        : other.kind === "tool" && sameTool(one, other);

const sameActivity = comparing<ActivityItem>({
    type: (one, other) => one.type === other.type,
    key: (one, other) => one.key === other.key,
    steps: (one, other) => sameList(one.steps, other.steps, sameStep),
    live: (one, other) => one.live === other.live,
    startedAt: (one, other) => one.startedAt === other.startedAt,
    endedAt: (one, other) => one.endedAt === other.endedAt,
});

const sameReply = comparing<ReplyItem>({
    type: (one, other) => one.type === other.type,
    key: (one, other) => one.key === other.key,
    text: (one, other) => one.text === other.text,
    streaming: (one, other) => one.streaming === other.streaming,
});

const sameError = comparing<ErrorItem>({
    type: (one, other) => one.type === other.type,
    key: (one, other) => one.key === other.key,
    text: (one, other) => one.text === other.text,
});

/** Whether two of `turnsOf`'s items show the same thing, for the memo on one item of a turn. */
export const sameItem = (one: Item, other: Item): boolean => {
    if (one.type === "activity") {
        return other.type === "activity" && sameActivity(one, other);
    }

    if (one.type === "reply") {
        return other.type === "reply" && sameReply(one, other);
    }

    return other.type === "error" && sameError(one, other);
};

const sameCounts = comparing<TurnStats>({
    model: (one, other) => one.model === other.model,
    thinkingLevel: (one, other) => one.thinkingLevel === other.thinkingLevel,
    responses: (one, other) => one.responses === other.responses,
    context: (one, other) => one.context === other.context,
    cached: (one, other) => one.cached === other.cached,
    output: (one, other) => one.output === other.output,
    cost: (one, other) => one.cost === other.cost,
    startedAt: (one, other) => one.startedAt === other.startedAt,
    endedAt: (one, other) => one.endedAt === other.endedAt,
});

/** Two turns' counts, one of which may have none. */
const sameStats = (one: TurnStats | undefined, other: TurnStats | undefined): boolean =>
    one === undefined || other === undefined ? one === other : sameCounts(one, other);

const sameMarker = comparing<NonNullable<Turn["compacted"]>>({
    summary: (one, other) => one.summary === other.summary,
});

/** Two turns' compaction markers, one of which may be missing. */
const sameCompacted = (one: Turn["compacted"], other: Turn["compacted"]): boolean =>
    one === undefined || other === undefined ? one === other : sameMarker(one, other);

/**
 * Whether two of `turnsOf`'s turns show the same thing, for the memo on the screen's turn: a chunk of a streamed answer
 * builds every turn anew, and only the turn at the end differs. What a turn keeps of the entries — their arguments, a
 * call's result, the person's message — compares by reference, and is rebuilt only when the turn itself changed. Its key
 * is not compared: the screen keys a turn by it, so the memo never sees two turns with different ones.
 */
export const sameTurn = comparing<Omit<Turn, "key">>({
    user: (one, other) => one.user === other.user,
    items: (one, other) => sameList(one.items, other.items, sameItem),
    live: (one, other) => one.live === other.live,
    stats: (one, other) => sameStats(one.stats, other.stats),
    compacted: (one, other) => sameCompacted(one.compacted, other.compacted),
});
