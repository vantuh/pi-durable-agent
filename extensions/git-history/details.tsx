import { DetailsColumn } from "@/ui/details.tsx";

export default function Details() {
    return (
        <DetailsColumn>
            <p className="text-faint">
                Diff layout follows Settings → Appearance → Diffs, shared with edit output.
                Plannotator has its own layout setting. Saved in this browser.
            </p>
        </DetailsColumn>
    );
}
