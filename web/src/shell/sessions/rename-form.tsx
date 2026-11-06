import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mounted only while its popover is open, so a draft always starts from the session's current name. */
export function RenameForm({
    id,
    name,
    pending,
    onSave,
    onCancel,
}: {
    id: number;
    name: string;
    pending: boolean;
    onSave: (id: number, name: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(name);

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                void onSave(id, draft);
            }}
            className="flex flex-col gap-2"
        >
            <label className="text-meta text-muted" htmlFor="rename-session">
                Session name
            </label>
            <Input
                id="rename-session"
                maxLength={80}
                value={draft}
                placeholder="Leave empty for automatic name"
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                className="border-edge-soft bg-canvas text-ui"
            />
            <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending} className="font-normal">
                    Save
                </Button>
            </div>
        </form>
    );
}
