import {
    ArrowLeft,
    ArrowRight,
    Monitor,
    RotateCw,
    Smartphone,
    Tablet,
    Terminal,
    X,
} from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import type { PanelProps } from "@/sdk/types.ts";
import { Loading } from "@/ui/loading.tsx";
import { Toolbar } from "@/ui/pane.tsx";

import { Console } from "./console.tsx";
import { IconButton } from "./icon-button.tsx";
import { Stage } from "./stage.tsx";
import { useFrame } from "./use-frame.ts";
import { usePageState } from "./use-page-state.ts";

const PRESETS = [
    { name: "mobile", hint: "Mobile", icon: Smartphone },
    { name: "tablet", hint: "Tablet", icon: Tablet },
    { name: "desktop", hint: "Desktop", icon: Monitor },
] as const;

export function BrowserPanel({ session }: PanelProps) {
    const id = session?.id ?? null;
    const { page, error, setError, run } = usePageState(id);
    const shot = useFrame(id, page?.open === true);
    const [draft, setDraft] = useState<string | null>(null);
    const [showConsole, setShowConsole] = useState(false);

    // What is typed shows while the field has focus; otherwise it shows where the page is.
    const address = draft ?? (page === undefined || page.url === "about:blank" ? "" : page.url);

    if (id === null) {
        return <Empty className="text-interface p-3">Open a session to use the browser.</Empty>;
    }

    if (page?.available === false) {
        return (
            <p className="text-muted text-interface p-3">
                No Chromium-based browser was found on this machine. Install Chromium or Chrome, or
                set PI_DURABLE_BROWSER to a browser's path.
            </p>
        );
    }

    const problem = error ?? page?.problem ?? null;

    return (
        <>
            <Toolbar className="gap-1 p-2">
                <IconButton
                    hint="Back"
                    disabled={page?.canGoBack !== true}
                    onClick={() => void run({ op: "back" })}
                >
                    <ArrowLeft className="size-4" />
                </IconButton>
                <IconButton
                    hint="Forward"
                    disabled={page?.canGoForward !== true}
                    onClick={() => void run({ op: "forward" })}
                >
                    <ArrowRight className="size-4" />
                </IconButton>
                <IconButton
                    hint={page?.loading === true ? "Stop" : "Reload"}
                    disabled={page?.open !== true}
                    onClick={() => void run({ op: page?.loading === true ? "stop" : "reload" })}
                >
                    {page?.loading === true ? (
                        <X className="size-4" />
                    ) : (
                        <RotateCw className="size-4" />
                    )}
                </IconButton>
                <form
                    className="min-w-0 flex-1"
                    onSubmit={(event) => {
                        event.preventDefault();

                        setDraft(null);

                        if (address.trim() !== "") {
                            void run({ op: "navigate", url: address });
                        }
                    }}
                >
                    <Input
                        value={address}
                        title={
                            page?.open === true
                                ? `${page.viewport.width}×${page.viewport.height} · ${page.title}`
                                : undefined
                        }
                        placeholder="localhost:5173, example.com or a file path"
                        onChange={(event) => {
                            setDraft(event.target.value);
                        }}
                        onBlur={() => {
                            setDraft(null);
                        }}
                        className="border-transparent px-2.5 font-mono"
                    />
                </form>
                {PRESETS.map(({ name, hint, icon: Icon }) => (
                    <IconButton
                        key={name}
                        hint={hint}
                        active={page?.preset === name}
                        onClick={() => void run({ op: "viewport", viewport: name })}
                    >
                        <Icon className="size-4" />
                    </IconButton>
                ))}
                <IconButton
                    hint="Console"
                    active={showConsole}
                    onClick={() => {
                        setShowConsole((open) => !open);
                    }}
                >
                    <Terminal className="size-4" />
                </IconButton>
                {page !== undefined && page.errors > 0 ? (
                    <span className="text-meta text-danger">{page.errors}</span>
                ) : null}
            </Toolbar>

            {problem === null ? null : <Alert className="px-3 py-1.5">{problem}</Alert>}

            {page?.open === true ? (
                <Stage id={id} shot={shot} onError={setError} />
            ) : page?.loading === true ? (
                // Not an empty state: the toolbar's Stop is the only action while the browser starts.
                <div className="flex flex-1 items-center justify-center p-4">
                    <Loading className="text-interface text-center">Starting the browser…</Loading>
                </div>
            ) : (
                <Empty className="text-interface flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                    <p>Nothing is open.</p>
                    <Button
                        variant="ghost"
                        onClick={() => void run({ op: "open" })}
                        className="bg-raised text-ink py-1"
                    >
                        Open the browser
                    </Button>
                </Empty>
            )}

            {showConsole ? <Console id={id} count={page?.logs ?? 0} /> : null}
        </>
    );
}
