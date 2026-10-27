import { Check } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { DefaultModel, ModelChoice } from "../../../shared/protocol.ts";
import { thinkingTab } from "../lib/thinking.ts";

type Props = {
    scoped: ModelChoice[];
    all: ModelChoice[];
    current: string | null;
    level: string | null;
    defaultModel: DefaultModel | null;
    onPick: (choice: ModelChoice, level: string) => void;
    onMakeDefault: (choice: ModelChoice, level: string) => void;
    onClose: () => void;
};

export function ModelMenu({
    scoped,
    all,
    current,
    level,
    defaultModel,
    onPick,
    onMakeDefault,
    onClose,
}: Props) {
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
    const isDefault =
        active !== undefined &&
        defaultModel?.provider === active.provider &&
        defaultModel.modelId === active.id &&
        defaultModel.thinkingLevel === (level ?? "off");

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                aria-describedby={undefined}
                className="bg-panel sm:h-[min(36rem,80dvh)] sm:max-w-xl"
            >
                <DialogHeader className="flex-row items-center gap-3 py-2">
                    <DialogTitle>Model</DialogTitle>
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
                </DialogHeader>

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

                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-1.5 pb-1.5">
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
                                                : (model.levels[0] ?? "off"),
                                        );
                                    }}
                                    className={`rounded-control flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left ${
                                        key === current ? "bg-raised" : "hover:bg-raised/50"
                                    }`}
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink text-interface block truncate">
                                            {model.name}
                                        </span>
                                        <span className="text-faint text-meta block truncate">
                                            {model.provider} ·{" "}
                                            {Math.round(model.contextWindow / 1000)}k
                                            {defaultModel?.provider === model.provider &&
                                            defaultModel.modelId === model.id
                                                ? " · default"
                                                : ""}
                                        </span>
                                    </span>
                                    {key === current ? (
                                        <Check className="text-accent size-4 shrink-0" />
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </ScrollArea>

                <div className="border-edge-soft border-t px-3 py-2">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="text-faint text-meta">Thinking</span>
                        <button
                            type="button"
                            disabled={active === undefined || isDefault}
                            title="New sessions start with this model and thinking level"
                            onClick={() => {
                                if (active !== undefined) {
                                    onMakeDefault(active, level ?? "off");
                                }
                            }}
                            className="rounded-control text-meta text-accent hover:bg-raised disabled:text-faint px-2 py-0.5 disabled:hover:bg-transparent"
                        >
                            {isDefault ? "Default for new sessions" : "Make default"}
                        </button>
                    </div>
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
                                <TabsTrigger
                                    key={option}
                                    value={option}
                                    className={thinkingTab(option)}
                                >
                                    {option}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    );
}
