import { ArrowLeft, ArrowRight, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { callAction } from "@/sdk/actions.ts";
import type { PanelProps } from "@/sdk/types.ts";
import { Toolbar } from "@/ui/pane.tsx";

import { messageOf } from "../../../shared/guards.ts";
import { type Control, control } from "../refs.ts";
import { IconButton } from "./icon-button.tsx";
import { Stage } from "./stage.tsx";
import { useStream } from "./use-stream.ts";

const PRESETS = [
    { name: "mobile", hint: "Mobile", icon: Smartphone },
    { name: "tablet", hint: "Tablet", icon: Tablet },
    { name: "desktop", hint: "Desktop", icon: Monitor },
] as const;

export function AgentBrowserPanel({ session }: PanelProps) {
    const id = session?.id ?? null;
    const page = useStream(id);
    const [draft, setDraft] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    const address = draft ?? (page.url === "about:blank" ? "" : page.url);
    const run = async (what: Control): Promise<void> => {
        try {
            await callAction(control, what, id);
            setFailure(null);
        } catch (error) {
            setFailure(messageOf(error));
        }
    };

    if (id === null) {
        return <Empty className="text-interface p-3">Open a session to use the browser.</Empty>;
    }

    const problem = failure ?? page.error;

    return (
        <>
            <Toolbar className="gap-1 p-2">
                <IconButton
                    hint="Back"
                    disabled={!page.connected}
                    onClick={() => void run({ op: "back" })}
                >
                    <ArrowLeft className="size-4" />
                </IconButton>
                <IconButton
                    hint="Forward"
                    disabled={!page.connected}
                    onClick={() => void run({ op: "forward" })}
                >
                    <ArrowRight className="size-4" />
                </IconButton>
                <IconButton
                    hint="Reload"
                    disabled={!page.connected}
                    onClick={() => void run({ op: "reload" })}
                >
                    <RotateCw className="size-4" />
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
                        title={page.title === "" ? undefined : page.title}
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
                        disabled={!page.connected}
                        onClick={() => void run({ op: "viewport", viewport: name })}
                    >
                        <Icon className="size-4" />
                    </IconButton>
                ))}
            </Toolbar>

            {problem === null ? null : <Alert className="px-3 py-1.5">{problem}</Alert>}

            {page.connected && page.shot !== undefined ? (
                <Stage shot={page.shot} send={page.send} />
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
        </>
    );
}
