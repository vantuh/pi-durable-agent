const CHECKED = [
    "react 19 + vite 8 + typescript 7",
    "tailwind 4 through @tailwindcss/vite",
    "oxlint and oxfmt",
    "@earendil-works/pi-durable 1.4.0 installed",
];

export function App() {
    return (
        <main className="grid h-full place-items-center bg-neutral-950 p-6 text-neutral-200">
            <div className="w-full max-w-md space-y-4">
                <div>
                    <h1 className="font-mono text-lg font-medium text-neutral-100">
                        pi-durable-agent
                    </h1>
                    <p className="text-sm text-neutral-400">
                        Toolchain is up. Nothing is built yet.
                    </p>
                </div>

                <ul className="space-y-1.5 font-mono text-xs text-neutral-500">
                    {CHECKED.map((line) => (
                        <li key={line}>✓ {line}</li>
                    ))}
                </ul>

                <p className="text-xs text-neutral-500">
                    Next: <code className="text-neutral-300">docs/layout.md</code>.
                </p>
            </div>
        </main>
    );
}
