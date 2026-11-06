import { ArrowLeft, ChevronRight, Puzzle, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { refreshExtensions } from "@/extensions.ts";
import { type ExtensionInfo, listExtensions, setExtensionEnabled } from "@/lib/api.ts";
import { fuzzyMatch } from "@/lib/fuzzy.ts";
import { Loading } from "@/ui/loading.tsx";
import { MatchText } from "@/ui/match-text.tsx";

import { ExtensionDetails, hasExtensionDetails } from "./extension-details.tsx";

/** The icon button for the Settings footer, and the modal it opens. */
export function ExtensionsButton() {
    return (
        <Dialog>
            <Hint label="Extensions">
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Extensions">
                        <Puzzle className="size-4" />
                    </Button>
                </DialogTrigger>
            </Hint>
            <DialogContent className="sm:h-[min(44rem,88dvh)] sm:max-w-2xl">
                <ExtensionList />
            </DialogContent>
        </Dialog>
    );
}

type Failure = { name: string; message: string };

const TITLE_WEIGHT = 100;

/** A row the search kept, with the characters that matched in its title and its description. */
type Found = {
    row: ExtensionInfo;
    score: number;
    title: [number, number][];
    description: [number, number][];
};

/** Title matches count above description ones; an empty query keeps every row in the server's order. */
function search(rows: ExtensionInfo[], query: string): Found[] {
    return rows
        .flatMap((row): Found[] => {
            const title = fuzzyMatch(row.title, query);
            const description = row.description === "" ? null : fuzzyMatch(row.description, query);

            if (title === null && description === null) {
                return [];
            }

            return [
                {
                    row,
                    score:
                        (title === null ? 0 : title.score + TITLE_WEIGHT) +
                        (description?.score ?? 0),
                    title: title?.ranges ?? [],
                    description: description?.ranges ?? [],
                },
            ];
        })
        .toSorted((left, right) => right.score - left.score);
}

function ExtensionList() {
    const [selected, setSelected] = useState<string | undefined>(undefined);
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<ExtensionInfo[] | undefined>(undefined);
    const [loadError, setLoadError] = useState<string | undefined>(undefined);
    const [failure, setFailure] = useState<Failure | undefined>(undefined);

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const found = await listExtensions();

                if (alive) {
                    setRows(found);
                }
            } catch (error) {
                if (alive) {
                    setLoadError(error instanceof Error ? error.message : "could not load");
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const replace = (info: ExtensionInfo): void => {
        setRows((current) => current?.map((row) => (row.name === info.name ? info : row)));
    };

    const toggle = async (row: ExtensionInfo, enabled: boolean): Promise<void> => {
        setFailure(undefined);
        replace({ ...row, enabled });

        try {
            replace(await setExtensionEnabled(row.name, enabled));
            await refreshExtensions();
        } catch (error) {
            replace(row);
            setFailure({
                name: row.name,
                message: error instanceof Error ? error.message : "the change failed",
            });
        }
    };

    const current = rows?.find((row) => row.name === selected);

    const header = (
        <DialogHeader>
            {current === undefined ? null : (
                <Button
                    variant="ghost"
                    className="border-edge-soft text-ink mb-1 w-fit border"
                    onClick={() => setSelected(undefined)}
                >
                    <ArrowLeft className="size-4" />
                    Extensions
                </Button>
            )}
            <DialogTitle className="text-heading">{current?.title ?? "Extensions"}</DialogTitle>
            <DialogDescription>
                {current === undefined
                    ? "Turn a feature on or off. It applies at once."
                    : current.description}
            </DialogDescription>
        </DialogHeader>
    );

    if (rows === undefined) {
        return (
            <>
                {header}
                {loadError === undefined ? (
                    <Loading className="text-meta animate-drop-in p-3" />
                ) : (
                    <Alert className="animate-drop-in p-3">{loadError}</Alert>
                )}
            </>
        );
    }

    if (current !== undefined) {
        const problem = failure?.name === current.name ? failure.message : current.error;

        return (
            <>
                {header}
                <ScrollArea key={current.name} className="animate-drop-in min-h-0 flex-1">
                    <div className="flex flex-col gap-3 px-3 py-3">
                        <div className="text-interface text-ink flex items-center justify-between gap-3">
                            Enabled
                            <Switch
                                checked={current.enabled}
                                aria-label={`Enable ${current.title}`}
                                onCheckedChange={(enabled) => {
                                    void toggle(current, enabled);
                                }}
                            />
                        </div>
                        {problem === undefined ? null : <Alert>{problem}</Alert>}
                        <Separator />
                        <div>
                            <ExtensionDetails
                                folder={current.name}
                                enabled={current.enabled}
                                installed={current.installed}
                            />
                        </div>
                    </div>
                </ScrollArea>
            </>
        );
    }

    const found = search(rows, query);

    return (
        <>
            {header}
            <div className="relative px-3 py-2">
                <Search className="text-faint pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2" />
                <Input
                    type="search"
                    value={query}
                    aria-label="Search extensions"
                    placeholder="Search extensions"
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
                    className="border-edge-soft text-ui pr-7 pl-7 [&::-webkit-search-cancel-button]:hidden"
                />
            </div>
            <ScrollArea key="list" className="animate-drop-in min-h-0 flex-1">
                {found.length === 0 ? (
                    <Empty className="px-3 py-3">No extensions match</Empty>
                ) : null}
                <ul className="divide-edge-soft flex flex-col divide-y">
                    {found.map(({ row, title, description }) => {
                        const problem = failure?.name === row.name ? failure.message : row.error;

                        return (
                            <li
                                key={row.name}
                                className={`relative px-3 py-2.5 ${hasExtensionDetails(row.name) ? "hover:bg-raised" : ""}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        {hasExtensionDetails(row.name) ? (
                                            <Button
                                                variant="ghost"
                                                className="text-ink justify-start px-0 py-0 text-left after:absolute after:inset-0"
                                                onClick={() => setSelected(row.name)}
                                            >
                                                <MatchText text={row.title} ranges={title} />
                                                <ChevronRight className="size-3 shrink-0" />
                                            </Button>
                                        ) : (
                                            <span className="text-interface text-ink">
                                                <MatchText text={row.title} ranges={title} />
                                            </span>
                                        )}
                                        {row.description === "" ? null : (
                                            <span
                                                id={`${row.name}-description`}
                                                className="text-meta text-muted"
                                            >
                                                <MatchText
                                                    text={row.description}
                                                    ranges={description}
                                                />
                                            </span>
                                        )}
                                        {problem === undefined ? null : (
                                            <Alert id={`${row.name}-problem`}>{problem}</Alert>
                                        )}
                                    </div>
                                    <Switch
                                        className="relative z-10"
                                        checked={row.enabled}
                                        aria-label={`Enable ${row.title}`}
                                        aria-describedby={
                                            [
                                                row.description === ""
                                                    ? undefined
                                                    : `${row.name}-description`,
                                                problem === undefined
                                                    ? undefined
                                                    : `${row.name}-problem`,
                                            ]
                                                .filter((id) => id !== undefined)
                                                .join(" ") || undefined
                                        }
                                        onCheckedChange={(enabled) => {
                                            void toggle(row, enabled);
                                        }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </ScrollArea>
        </>
    );
}
