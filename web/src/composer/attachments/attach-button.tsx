import { Paperclip } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
    const picker = useRef<HTMLInputElement>(null);

    return (
        <>
            <Hint label="Attach a file">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Attach a file"
                    onClick={() => {
                        picker.current?.click();
                    }}
                >
                    <Paperclip className="size-4" />
                </Button>
            </Hint>

            <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                    const chosen = [...(event.target.files ?? [])];

                    event.target.value = "";

                    if (chosen.length === 0) {
                        return;
                    }

                    onFiles(chosen);
                }}
            />
        </>
    );
}
