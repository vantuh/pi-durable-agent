import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModelMenu } from "@/composer/model-menu.tsx";
import { listModels, type Models } from "@/lib/api.ts";
import { callAction } from "@/sdk/actions.ts";

import { profiles as profilesRef, setModel, type ProfileRow } from "./refs.ts";

function message(cause: unknown, fallback: string): string {
    return cause instanceof Error ? cause.message : fallback;
}

/** The profiles a spawn could pick, each with the model its Markdown names, and the way to change it. */
export function ProfileModels({ compact = false }: { compact?: boolean }) {
    const [rows, setRows] = useState<ProfileRow[] | null>(null);
    const [models, setModels] = useState<Models | null>(null);
    const [editing, setEditing] = useState<ProfileRow | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const found = await callAction(profilesRef, undefined, null);

                if (alive) {
                    setRows(found);
                    setError(null);
                }
            } catch (cause) {
                if (alive) {
                    setError(message(cause, "Could not read the profiles"));
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const write = async (
        profile: string,
        model: string | null,
        thinking: string | null,
    ): Promise<void> => {
        setSaving(true);

        try {
            setRows(await callAction(setModel, { profile, model, thinking }, null));
            setError(null);
        } catch (cause) {
            setError(message(cause, "Could not write the profile"));
        } finally {
            setSaving(false);
        }
    };

    const open = (row: ProfileRow): void => {
        setEditing(row);
        setModels(null);

        void (async () => {
            try {
                setModels(await listModels());
            } catch (cause) {
                setEditing(null);
                setError(message(cause, "Could not read the models"));
            }
        })();
    };

    return (
        <div className="text-meta flex flex-col gap-2">
            {error === null ? null : (
                <p role="alert" className="text-danger break-words">
                    {error}
                </p>
            )}

            {rows === null ? <p className="text-faint">Loading…</p> : null}
            {rows?.length === 0 ? (
                <p className="text-faint">
                    No profiles yet: add a Markdown file with a name, a description and a model to
                    ~/.pi/agent/agents, or to the project&apos;s .pi/agents.
                </p>
            ) : null}

            <ul className={`flex flex-col ${compact ? "gap-1" : "gap-2"}`}>
                {(rows ?? []).map((row) => (
                    <li
                        key={row.name}
                        className={`border-edge-soft rounded-card flex flex-col border ${compact ? "gap-0.5 px-2 py-1" : "gap-1.5 px-2.5 py-2"}`}
                    >
                        <div
                            className={`flex justify-between gap-2 ${compact ? "items-center" : "items-start"}`}
                        >
                            <div className="min-w-0">
                                <span className="text-ink text-interface block truncate">
                                    {row.name}
                                </span>
                                {compact ? null : (
                                    <span className="text-muted block break-words">
                                        {row.description}
                                    </span>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center">
                                {row.model === null ? null : (
                                    <Button
                                        variant="ghost"
                                        className={
                                            compact
                                                ? "text-meta h-6 px-1.5 py-0"
                                                : "text-meta px-2 py-1"
                                        }
                                        disabled={saving}
                                        onClick={() => {
                                            void write(row.name, null, null);
                                        }}
                                    >
                                        {compact ? "Default" : "Use default"}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    className={
                                        compact
                                            ? "text-meta h-6 px-1.5 py-0"
                                            : "text-meta px-2 py-1"
                                    }
                                    disabled={saving}
                                    onClick={() => {
                                        open(row);
                                    }}
                                >
                                    {compact ? "Change" : "Change model"}
                                </Button>
                            </div>
                        </div>
                        <span className={`text-faint font-mono ${compact ? "truncate" : ""}`}>
                            {row.model ?? "no model: agent_spawn refuses this profile"}
                            {row.thinking === null ? "" : ` · thinking ${row.thinking}`}
                        </span>
                    </li>
                ))}
            </ul>

            {editing === null || models === null ? null : (
                <ModelMenu
                    scoped={models.scoped}
                    all={models.all}
                    current={editing.model}
                    level={editing.thinking}
                    onPick={(choice, level) => {
                        void write(editing.name, `${choice.provider}/${choice.id}`, level);
                    }}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}
