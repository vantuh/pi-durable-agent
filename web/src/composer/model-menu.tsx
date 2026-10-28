import { Check, Plus } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { DefaultModel, ModelChoice } from "../../../shared/protocol.ts";
import { thinkingTab } from "../lib/thinking.ts";

type Props = {
    /** Absent: no scoped/all tabs, and `all` is the whole list. */
    scoped?: ModelChoice[];
    all: ModelChoice[];
    current: string | null;
    level: string | null;
    /** Absent: no "default" marker on a row and no Make default. */
    defaultModel?: DefaultModel | null;
    onPick: (choice: ModelChoice, level: string) => void;
    /** Absent: no button to add a model to the scoped list. */
    onAddScoped?: (choice: ModelChoice) => void;
    onMakeDefault?: (choice: ModelChoice, level: string) => void;
    onClose: () => void;
};

export function ModelMenu({
    scoped,
    all,
    current,
    level,
    defaultModel,
    onPick,
    onAddScoped,
    onMakeDefault,
    onClose,
}: Props) {
    const [tab, setTab] = useState<"scoped" | "all">("scoped");
    const [query, setQuery] = useState("");
    // The chosen model is applied by OK; a row click or an arrow key only moves this mark.
    const [chosen, setChosen] = useState<string | null>(current);
    const [thinking, setThinking] = useState<string | null>(null);
    const search = useRef<HTMLInputElement>(null);

    const scopedList = scoped ?? [];
    const list = scoped === undefined || tab === "all" ? all : scopedList;
    const needle = query.trim().toLowerCase();
    const shown = list.filter(
        (model) =>
            needle === "" ||
            model.name.toLowerCase().includes(needle) ||
            model.id.toLowerCase().includes(needle) ||
            model.provider.toLowerCase().includes(needle),
    );
    const every = [...scopedList, ...all];
    const scopedKeys = new Set(scopedList.map((model) => `${model.provider}/${model.id}`));
    const active = every.find((model) => `${model.provider}/${model.id}` === current);
    const picked = every.find((model) => `${model.provider}/${model.id}` === chosen);
    const levels = picked?.levels ?? active?.levels ?? ["off"];
    const wanted = thinking ?? level ?? "off";
    const thinkingLevel = levels.includes(wanted) ? wanted : (levels[0] ?? "off");
    const isDefault =
        picked !== undefined &&
        defaultModel !== undefined &&
        defaultModel !== null &&
        defaultModel.provider === picked.provider &&
        defaultModel.modelId === picked.id &&
        defaultModel.thinkingLevel === thinkingLevel;
    const appliable =
        picked !== undefined && (chosen !== current || thinkingLevel !== (level ?? "off"));

    const apply = (model: ModelChoice): void => {
        const wantedLevel = thinking ?? level ?? "off";

        onPick(
            model,
            model.levels.includes(wantedLevel) ? wantedLevel : (model.levels[0] ?? "off"),
        );
        onClose();
    };

    const applyOnEnter = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && picked !== undefined) {
            event.preventDefault();
            apply(picked);
        }
    };

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
                onOpenAutoFocus={(event) => {
                    // A phone would put the on-screen keyboard over the list; there Radix focuses the tabs.
                    if (!window.matchMedia("(pointer: fine)").matches) {
                        return;
                    }

                    event.preventDefault();
                    search.current?.focus();
                }}
            >
                <DialogHeader className="flex-row items-center gap-3 py-2">
                    <DialogTitle>Model</DialogTitle>
                    {scoped === undefined ? null : (
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
                    )}
                </DialogHeader>

                <Command
                    label="Models"
                    shouldFilter={false}
                    // A hover shows a hover colour and nothing else: the mark moves on a click or an arrow key.
                    disablePointerSelection
                    {...(chosen === null ? {} : { value: chosen })}
                    onValueChange={setChosen}
                    onKeyDown={applyOnEnter}
                >
                    <CommandInput
                        ref={search}
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search models"
                    />
                    <ScrollArea className="min-h-0 flex-1">
                        <CommandList label="Models" className="px-1.5 pb-1.5">
                            <CommandEmpty>No model matches.</CommandEmpty>

                            {shown.map((model) => {
                                const key = `${model.provider}/${model.id}`;

                                return (
                                    <CommandItem
                                        key={key}
                                        value={key}
                                        onDoubleClick={() => {
                                            apply(model);
                                        }}
                                        className="justify-between pr-1.5"
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
                                        {key === chosen ? (
                                            <Check className="text-accent size-4 shrink-0" />
                                        ) : null}
                                        {onAddScoped !== undefined &&
                                        tab === "all" &&
                                        !scopedKeys.has(key) ? (
                                            <button
                                                type="button"
                                                title="Add to scoped models"
                                                aria-label="Add to scoped models"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onAddScoped(model);
                                                }}
                                                className="rounded-control text-faint hover:bg-sunken hover:text-ink shrink-0 p-1.5"
                                            >
                                                <Plus className="size-4" />
                                            </button>
                                        ) : null}
                                    </CommandItem>
                                );
                            })}
                        </CommandList>
                    </ScrollArea>
                </Command>

                <div className="border-edge-soft border-t px-3 py-2">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="text-faint text-meta">Thinking</span>
                        {onMakeDefault === undefined ? null : (
                            <button
                                type="button"
                                disabled={picked === undefined || isDefault}
                                title="New sessions start with this model and thinking level"
                                onClick={() => {
                                    if (picked !== undefined) {
                                        onMakeDefault(picked, thinkingLevel);
                                    }
                                }}
                                className="rounded-control text-meta text-accent hover:bg-raised disabled:text-faint px-2 py-0.5 disabled:hover:bg-transparent"
                            >
                                {isDefault ? "Default for new sessions" : "Make default"}
                            </button>
                        )}
                    </div>
                    <Tabs
                        value={thinkingLevel}
                        onKeyDown={applyOnEnter}
                        onValueChange={(option) => {
                            setThinking(option);
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

                <DialogFooter className="border-edge-soft border-t">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!appliable}
                        onClick={() => {
                            if (picked !== undefined) {
                                apply(picked);
                            }
                        }}
                    >
                        OK
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
