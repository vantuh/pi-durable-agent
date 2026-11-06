import {
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    useEffect,
    useRef,
    useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callAction } from "@/sdk/actions.ts";

import { messageOf } from "../../../shared/guards.ts";
import { reword, type Commit } from "../refs.ts";
import { pageButton } from "./page-button.ts";

function submitOnEnter(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    }
}

export function RewordForm({
    session,
    commit,
    onRewritten,
    onClose,
}: {
    session: number;
    commit: Commit;
    onRewritten: () => void;
    onClose: () => void;
}) {
    const [subject, setSubject] = useState(commit.subject);
    const [body, setBody] = useState(commit.body);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        titleRef.current?.focus();
    }, []);
    async function save(event: FormEvent) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await callAction(reword, { hash: commit.hash, subject, body }, session);
            onRewritten();
        } catch (failure) {
            setError(messageOf(failure));
            setSaving(false);
        }
    }
    return (
        <form
            onSubmit={(event) => {
                void save(event);
            }}
            className="border-edge-soft bg-panel space-y-2 border-t px-3 py-3"
        >
            <p className="text-meta text-muted">
                <span className="font-mono">{commit.short}</span> and the commits after it get new
                ids. The files stay as they are.
            </p>
            <Field>
                <Label htmlFor="reword-title">Title</Label>
                <Input
                    id="reword-title"
                    ref={titleRef}
                    value={subject}
                    aria-invalid={error !== null}
                    aria-describedby={error === null ? undefined : "reword-error"}
                    onChange={(event) => {
                        setSubject(event.target.value);
                    }}
                    onKeyDown={submitOnEnter}
                />
            </Field>
            <Field>
                <Label htmlFor="reword-description">Description</Label>
                <Textarea
                    id="reword-description"
                    rows={6}
                    value={body}
                    aria-invalid={error !== null}
                    aria-describedby={error === null ? undefined : "reword-error"}
                    onChange={(event) => {
                        setBody(event.target.value);
                    }}
                    onKeyDown={submitOnEnter}
                />
            </Field>
            {error === null ? null : <FieldError id="reword-error">{error}</FieldError>}
            <div className="flex gap-2">
                <Button variant="ghost" className={pageButton} disabled={saving} onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    className="px-4 py-1.5 disabled:opacity-40"
                    disabled={saving || subject.trim() === ""}
                >
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
        </form>
    );
}
