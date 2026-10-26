import { Check, X } from "lucide-react";
import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ModelChoice } from "../../../shared/protocol.ts";

type Props = {
    scoped: ModelChoice[];
    all: ModelChoice[];
    current: string | null;
    level: string | null;
    onPick: (choice: ModelChoice, level: string) => void;
    onClose: () => void;
};

export function ModelMenu({ scoped, all, current, level, onPick, onClose }: Props) {
    const [tab, setTab] = useState<"scoped" | "all">("scoped");
    const [query, setQuery] = useState("");

    const list = tab === "scoped" ? scoped : all;
    const needle = query.trim().toLowerCase();
    const shown = list.filter(
        (model) =>
            needle === "" ||
            model.name.toLowerCase().includes(needle) ||
            model.id.toLowerCase().includes(needle) ||
            model.provider.toLowerCase().includes(needle),
    );
    const active = [...scoped, ...all].find((model) => `${model.provider}/${model.id}` === current);
    const levels = active?.levels ?? ["off"];

    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
            <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="bg-sunken/70 absolute inset-0 cursor-default"
            />
            <div className="rounded-card border-edge-soft bg-panel relative flex h-[min(36rem,80vh)] w-full max-w-xl flex-col border shadow-lg">
                <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2">
                    <div className="text-interface flex items-center gap-3">
                        <span className="text-ink">Model</span>
                        <Tabs
                            value={tab}
                            onValueChange={(value) => {
                                setTab(value === "all" ? "all" : "scoped");
                            }}
                        >
                            <TabsList>
                                <TabsTrigger value="scoped">scoped</TabsTrigger>
                                <TabsTrigger value="all">all</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        title="Close"
                        className="text-muted hover:text-ink flex size-6 items-center justify-center"
                    >
                        <X className="size-4" />
                    </button>
                </header>

                <div className="px-3 py-2">
                    <input
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                        placeholder="Search models"
                        className="rounded-control border-edge-soft bg-sunken text-interface text-ink placeholder:text-faint w-full border px-2.5 py-1.5 outline-none"
                    />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
                    {shown.length === 0 ? (
                        <p className="text-faint text-meta p-2">No model matches.</p>
                    ) : null}

                    {shown.map((model) => {
                        const key = `${model.provider}/${model.id}`;

                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => {
                                    onPick(
                                        model,
                                        model.levels.includes(level ?? "")
                                            ? (level ?? "off")
                                            : "off",
                                    );
                                }}
                                className={`rounded-control flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left ${
                                    key === current ? "bg-raised" : "hover:bg-raised"
                                }`}
                            >
                                <span className="min-w-0">
                                    <span className="text-ink text-interface block truncate">
                                        {model.name}
                                    </span>
                                    <span className="text-faint text-meta block truncate">
                                        {model.provider} · {Math.round(model.contextWindow / 1000)}k
                                    </span>
                                </span>
                                {key === current ? (
                                    <Check className="text-accent size-4 shrink-0" />
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                <div className="border-edge-soft border-t px-3 py-2">
                    <div className="text-faint text-meta mb-1">Thinking</div>
                    <Tabs
                        value={level ?? "off"}
                        onValueChange={(option) => {
                            if (active !== undefined) {
                                onPick(active, option);
                            }
                        }}
                    >
                        <TabsList className="w-full">
                            {levels.map((option) => (
                                <TabsTrigger key={option} value={option}>
                                    {option}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
