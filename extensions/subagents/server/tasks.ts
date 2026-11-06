import {
    AssistantEntry,
    type ConversationId,
    defineTask,
    type NextTaskState,
} from "@earendil-works/pi-durable";

import { answerModel, answerText } from "./answer.ts";
import { AgentsDoc } from "./docs.ts";

/** Owns an agent's conversation and ends at once: a background boundary, nothing more. */
export const Anchor = defineTask<null, { phase: "done" }, null>({
    name: "subagents.anchor",
    version: 1,
    initial: () => ({ phase: "done" }),
    phases: {
        done: (_task, runtime, context) =>
            runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                context,
            ),
    },
    abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type ReporterInput = {
    name: string;
    conversationId: ConversationId;
    message: string;
    /** The agent's `stops` when this was made. */
    stops?: number;
};
/** `report` is what the parent's model reads; `text`, what its screen shows under the agent's name. */
type ReporterState =
    | { phase: "deliver" }
    | { phase: "report"; report?: string; text?: string; model?: string };

/** Delivers one message to an agent and its answer, or why there is none, to the parent. */
export const Reporter = defineTask<ReporterInput, ReporterState, null>({
    name: "subagents.reporter",
    version: 1,
    initial: () => ({ phase: "deliver" }),
    phases: {
        deliver: async (task, runtime, context) => {
            const { name, conversationId, message, stops = 0 } = task.input;
            const child = await runtime.conversation(conversationId, context);
            const stoppedSince = async () =>
                ((await runtime.snapshot(AgentsDoc, runtime.conversationId, context))?.agents[name]
                    ?.stops ?? 0) !== stops;
            const submission =
                child === undefined || (await stoppedSince())
                    ? undefined
                    : await child.submit(
                          {
                              type: "input",
                              content: message,
                              entry: {
                                  kind: "subagents.instruction",
                                  data: {
                                      text: message,
                                      author: "Orchestrator",
                                      session: runtime.conversationId,
                                  },
                              },
                              whenBusy: "steer",
                              requestId: `subagents:${task.id}`,
                          },
                          context,
                      );

            // A stop between the check above and the submit has already aborted the child, so this one is withdrawn here.
            if (
                child !== undefined &&
                submission !== undefined &&
                (await stoppedSince()) &&
                (await submission.abort(context)) === "already_placed"
            ) {
                await child.abort(context);
            }

            const settled = await submission?.wait(context);

            await runtime.commit(async (tx) => {
                const next = (
                    report?: string,
                    text?: string,
                    model?: string,
                ): NextTaskState<ReporterState, null> => ({
                    status: "running",
                    checkpoint:
                        report === undefined || text === undefined
                            ? { phase: "report" }
                            : {
                                  phase: "report",
                                  report,
                                  text,
                                  ...(model === undefined ? {} : { model }),
                              },
                });
                const failed = (why: string) =>
                    next(`[agent ${name} failed: ${why}]`, `Failed: ${why}`);
                const record = (await tx.doc(AgentsDoc, runtime.conversationId)).agents[name];

                if ((record?.stops ?? 0) !== stops) {
                    return next();
                }

                if (settled === undefined) {
                    return failed("its conversation is gone");
                }

                if (settled.status === "unanswered") {
                    return record?.stopped === true ? next() : failed(settled.reason);
                }

                if (
                    settled.type !== "input" ||
                    record === undefined ||
                    record.reported.includes(settled.answer)
                ) {
                    return next();
                }

                record.reported.push(settled.answer);
                const entry = await tx.entry(AssistantEntry, settled.answer);
                const answer = answerText(entry) || "(no text)";

                return next(
                    `[agent ${name} (${record.agent}) finished]\n\n${answer}`,
                    answer,
                    answerModel(entry),
                );
            }, context);
        },
        report: async (task, runtime, context) => {
            const { report, text, model } = task.state.checkpoint;
            const { name, conversationId } = task.input;

            if (report !== undefined) {
                const parent = await runtime.conversation(runtime.conversationId, context);

                await parent?.submit(
                    {
                        type: "input",
                        content: report,
                        entry: {
                            kind: "subagents.report",
                            data: {
                                text: text ?? report,
                                author: name,
                                session: conversationId,
                                ...(model === undefined ? {} : { model }),
                            },
                        },
                        whenBusy: "steer",
                        requestId: `subagents-report:${task.id}`,
                    },
                    context,
                );
            }

            await runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                context,
            );
        },
    },
    abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});
