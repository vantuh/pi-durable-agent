/**
 * The Extensions dialog's view of Bash timeout: one number, the longest any bash command may run. A
 * details view rather than a `web.tsx` feature, so the limit sits beside the folder's switch and a
 * folder that is off activates nothing in the browser.
 */

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { MAX_MINUTES, MIN_MINUTES, saveSettings, settings } from "./refs.ts";

function messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : "Something went wrong.";
}

export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    // Actions come from the server half, which is not there while the folder is off or failed.
    if (!enabled) {
        return <p className="text-meta text-muted">Turn Bash timeout on to change its limit.</p>;
    }

    if (!installed) {
        return (
            <p className="text-meta text-muted">
                Bash timeout did not load; the limit is unavailable.
            </p>
        );
    }

    return <Limit />;
}

function Limit() {
    const [current, setCurrent] = useState<number | undefined>();
    const [typed, setTyped] = useState("");
    const [error, setError] = useState<string | undefined>();
    // Saves go out in order but their answers need not arrive in order: only the last may draw.
    const turn = useRef(0);

    useEffect(() => {
        let live = true;

        void (async () => {
            try {
                const found = await callAction(settings, undefined, null);

                if (live) {
                    setCurrent(found.minutes);
                    setTyped(String(found.minutes));
                }
            } catch (failure) {
                if (live) {
                    setError(messageOf(failure));
                }
            }
        })();

        return () => {
            live = false;
        };
    }, []);

    // A refusal leaves the file as it was, so the box goes back to what the server held before it.
    const save = async (minutes: number, before: number, mine: number): Promise<void> => {
        try {
            const answer = await callAction(saveSettings, { minutes }, null);

            if (mine === turn.current) {
                setCurrent(answer.minutes);
                setTyped(String(answer.minutes));
                setError(undefined);
            }
        } catch (failure) {
            if (mine === turn.current) {
                setTyped(String(before));
                setError(messageOf(failure));
            }
        }
    };

    // A number is saved when it is done, never per keystroke: on Enter, and on leaving the box.
    const commit = (): void => {
        const text = typed.trim();

        if (current === undefined) {
            return;
        }

        if (text === "") {
            setTyped(String(current));

            return;
        }

        const mine = ++turn.current;

        void save(Number(text), current, mine);
    };

    if (current === undefined) {
        return error === undefined ? <Spinner className="text-faint" /> : <Alert>{error}</Alert>;
    }

    return (
        <div className="flex flex-col gap-2">
            <label className="flex w-[30%] flex-col gap-1" htmlFor="bash-timeout-minutes">
                <span className="text-meta text-faint">Longest run (minutes)</span>
                <Input
                    id="bash-timeout-minutes"
                    type="number"
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    value={typed}
                    onChange={(event) => {
                        setTyped(event.target.value);
                    }}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commit();
                        }
                    }}
                />
            </label>
            <p className="text-meta text-muted">
                Every bash command stops after this long, {MIN_MINUTES} to {MAX_MINUTES} minutes. A
                command that asks for less keeps its own timeout.
            </p>
            {error === undefined ? null : <Alert>{error}</Alert>}
        </div>
    );
}
