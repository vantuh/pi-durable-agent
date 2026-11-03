import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { ModelMenu } from "@/composer/model-menu.tsx";
import { listModels, type Models } from "@/lib/api.ts";
import { callAction } from "@/sdk/actions.ts";
import { DetailsColumn } from "@/ui/details.tsx";
import { Loading } from "@/ui/loading.tsx";
import { PANE } from "@/ui/pane.tsx";

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
        <DetailsColumn>
            {error === null ? null : <Alert>{error}</Alert>}

            {rows === null ? <Loading /> : null}
            {rows?.length === 0 ? (
                <Empty>
                    No profiles yet: add a Markdown file with a name, a description and a model to
                    ~/.pi/agent/agents, or to the project&apos;s .pi/agents.
                </Empty>
            ) : null}

            <ul className={`flex flex-col ${compact ? "gap-1" : "gap-2"}`}>
                {(rows ?? []).map((row) => (
                    <li
                        key={row.name}
                        className={`${PANE} flex flex-col ${compact ? "gap-0.5 px-2 py-1" : "gap-1.5 px-2.5 py-2"}`}
                    >
                        <div
                            className={`flex justify-between gap-2 ${compact ? "items-center" : "items-start"}`}
                        >
                            <ItemContent>
                                <ItemTitle className="text-interface">{row.name}</ItemTitle>
                                {compact ? null : (
                                    <span className="text-muted block break-words">
                                        {row.description}
                                    </span>
                                )}
                            </ItemContent>
                            <ItemActions>
                                <Button
                                    variant="ghost"
                                    className={
                                        compact
                                            ? "text-meta h-6 px-1.5 py-0 font-medium"
                                            : "text-meta px-2 py-1 font-medium"
                                    }
                                    disabled={saving}
                                    onClick={() => {
                                        open(row);
                                    }}
                                >
                                    {compact ? "Change" : "Change model"}
                                </Button>
                            </ItemActions>
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
        </DetailsColumn>
    );
}
