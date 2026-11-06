export function ThoughtBody({ text }: { text: string }) {
    return (
        <p className="border-spark/30 bg-sunken text-ui text-muted border-l-2 px-3 py-2.5 whitespace-pre-wrap italic">
            {text}
        </p>
    );
}
