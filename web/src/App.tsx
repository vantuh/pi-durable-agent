import { useState } from "react";

import { useConversation } from "./lib/conversation.ts";
import { type Flavour, currentFlavour } from "./lib/flavour.ts";
import { Composer } from "./parts/composer.tsx";
import { Sessions } from "./parts/sessions.tsx";
import { Settings } from "./parts/settings.tsx";
import { StatusBar } from "./parts/status-bar.tsx";
import { Transcript } from "./parts/transcript.tsx";

function titleOf(entries: ReturnType<typeof useConversation>["state"]["entries"]): string | null {
    for (const entry of entries) {
        if (entry.kind === "user" && entry.text.trim() !== "") {
            return entry.text.trim().slice(0, 80);
        }
    }

    return null;
}

export function App() {
    const { state, health, send, stop } = useConversation();
    const [flavour, setFlavour] = useState<Flavour>(currentFlavour);
    const [open, setOpen] = useState(false);

    const cwd = health?.cwd ?? "";
    const branch = health?.branch ?? null;
    const model = state.model === "" ? (health?.model ?? "") : state.model;
    const title = titleOf(state.entries) ?? health?.title ?? null;

    return (
        <div className="bg-sunken flex h-full flex-col gap-2 p-2">
            <div className="flex min-h-0 flex-1 items-stretch gap-2">
                <Sessions cwd={cwd} title={title} busy={state.live.busy} />

                <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                    <Transcript
                        title={title}
                        branch={branch}
                        entries={state.entries}
                        live={state.live}
                        onSettings={() => {
                            setOpen(true);
                        }}
                    />
                    <Composer
                        busy={state.live.busy}
                        model={model}
                        onSend={send}
                        onStop={() => {
                            void stop();
                        }}
                    />
                </main>

                {open ? (
                    <Settings
                        flavour={flavour}
                        model={model}
                        cwd={cwd}
                        branch={branch}
                        onFlavour={setFlavour}
                        onClose={() => {
                            setOpen(false);
                        }}
                    />
                ) : null}
            </div>

            <StatusBar
                connected={state.connected}
                model={model}
                cwd={cwd}
                branch={branch}
                usage={state.live.usage}
                busy={state.live.busy}
                issue={state.issue}
            />
        </div>
    );
}
