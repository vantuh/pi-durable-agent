import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModelMenu } from "@/composer/model-menu.tsx";
import { listModels, type Models } from "@/lib/api.ts";
import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { profiles as profilesRef, setModel, type ProfileRow } from "./refs.ts";

function message(cause: unknown, fallback: string): string {
    return cause instanceof Error ? cause.message : fallback;
}

/** The profiles a spawn could pick, each with the model its Markdown names. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const [rows, setRows] = useState<ProfileRow[] | null>(null);
    const [models, setModels] = useState<Models | null>(null);
    const [editing, setEditing] = useState<ProfileRow | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!active) {
            return undefined;
        }

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
    }, [active]);

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

    if (!active) {
        return (
            <p className="text-faint text-meta">
                Turn Subagents on to change the model of a profile.
            </p>
        );
    }

    return (
        <div className="text-meta flex flex-col gap-2">
            <p className="text-faint">
                The model is written into the profile&apos;s Markdown, so the next agent_spawn uses
                it. An agent already running keeps the model it started with.
            </p>

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

            <ul className="flex flex-col gap-2">
                {(rows ?? []).map((row) => (
                    <li
                        key={row.name}
                        className="border-edge-soft rounded-card flex flex-col gap-1.5 border px-2.5 py-2"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <span className="text-ink text-interface block truncate">
                                    {row.name}
                                </span>
                                <span className="text-muted block break-words">
                                    {row.description}
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {row.model === null ? null : (
                                    <Button
                                        variant="ghost"
                                        className="text-meta px-2 py-1"
                                        disabled={saving}
                                        onClick={() => {
                                            void write(row.name, null, null);
                                        }}
                                    >
                                        Use default
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    className="text-meta px-2 py-1"
                                    disabled={saving}
                                    onClick={() => {
                                        open(row);
                                    }}
                                >
                                    Change model
                                </Button>
                            </div>
                        </div>
                        <span className="text-faint font-mono">
                            {row.model ?? "no model: agent_spawn refuses this profile"}
                            {row.thinking === null ? "" : ` · thinking ${row.thinking}`}
                        </span>
                    </li>
                ))}
            </ul>

            {editing === null || models === null ? null : (
                <ModelMenu
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
