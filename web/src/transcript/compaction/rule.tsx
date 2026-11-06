import { Separator } from "@/components/ui/separator";

/** The line beside a compaction pill: a span, because two of its hosts are collapsible triggers, which are buttons. */
export const Rule = () => (
    <Separator asChild className="flex-1">
        <span />
    </Separator>
);
