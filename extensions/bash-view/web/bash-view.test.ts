import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { startVite } from "../../../test/fixtures/vite.ts";

void it("highlights interpreter code inside one frame and copies the complete shell command", async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    let mode = "raw";
    let copied = "";

    Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => mode },
    });
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
            clipboard: {
                writeText: (text: string) => {
                    copied = text;

                    return Promise.resolve();
                },
            },
        },
    });

    const { vite, stop } = await startVite("custom", { optimizeDeps: { noDiscovery: true } });
    const { BashView } = await vite.ssrLoadModule(
        resolve("extensions/bash-view/web/bash-view.tsx"),
    );
    const { TooltipProvider } = await vite.ssrLoadModule("/src/components/ui/tooltip.tsx");
    const container = document.createElement("div");
    const root = createRoot(container);
    const body = "const n = 1;\n\nconsole.log(n);";
    const header = "node --input-type=module <<'JS'";
    const heredoc = `${header}\n${body}\nJS`;
    const commit = 'git commit --amend -m "feat: test" -m "first line\nsecond line"';
    const commands = [
        {
            source: `sed -n '1,5p' file; cat types.d.ts; ${heredoc}`,
            formatted: `sed -n '1,5p' file\ncat types.d.ts\n${heredoc}`,
            keyword: "const",
            code: body,
            marked: ["const n = 1;", "", "console.log(n);"],
        },
        {
            source: `python3 -c 'import os; print(os.getcwd())' > /tmp/out`,
            formatted: `python3 -c 'import os; print(os.getcwd())' > /tmp/out`,
            keyword: "import",
            code: "import os; print(os.getcwd())",
            marked: [],
        },
        {
            source: "python3 - <<'PY'\nimport os\n\nprint(os.getcwd())\nPY",
            formatted: "python3 - <<'PY'\nimport os\n\nprint(os.getcwd())\nPY",
            keyword: "import",
            code: "import os\n\nprint(os.getcwd())",
            marked: ["import os", "", "print(os.getcwd())"],
        },
        {
            source: `git add README.md && ${commit} && git status --short`,
            formatted: `git add README.md &&\n  ${commit} &&\n  git status --short`,
            keyword: "git",
            tokenClass: "text-code-function",
            code: "first line\nsecond line",
            marked: [],
            rows: ["git add README.md", commit, "git status --short"],
        },
    ];

    try {
        for (const view of ["raw", "formatted", "panels"]) {
            mode = view;

            for (const command of commands) {
                act(() => {
                    root.render(
                        createElement(
                            TooltipProvider,
                            null,
                            createElement(BashView, { command: command.source }),
                        ),
                    );
                });

                const highlighted = () =>
                    [
                        ...container.querySelectorAll(
                            `.${command.tokenClass ?? "text-code-keyword"}`,
                        ),
                    ].some((token) => token.textContent?.trim() === command.keyword);
                const deadline = Date.now() + 5000;

                while (!highlighted() && Date.now() < deadline) {
                    await act(async () => {
                        await delay(20);
                    });
                }

                assert.ok(highlighted(), `${view}: interpreter keyword uses its own grammar`);
                assert.equal(container.querySelectorAll(".bg-sunken").length, 1, view);
                assert.deepEqual(
                    [...container.querySelectorAll("span.border-l-2.bg-panel")].map(
                        (line) => line.textContent,
                    ),
                    command.marked,
                    `${view}: only embedded code lines get a background and marker, including blank lines`,
                );
                assert.equal(
                    container.textContent.split(command.code).length - 1,
                    1,
                    `${view}: no duplicate code`,
                );

                if (view !== "panels") {
                    const expected = view === "raw" ? command.source : command.formatted;

                    assert.equal(container.querySelectorAll("pre").length, 1, view);
                    assert.equal(container.querySelector("pre code")?.textContent, expected, view);
                    const copy = container.querySelector(
                        'button[aria-label="Copy"], button[aria-label="Copied"]',
                    );

                    assert.ok(copy);
                    await act(async () => {
                        copy.dispatchEvent(new window.Event("click", { bubbles: true }));
                        await Promise.resolve();
                    });
                    assert.equal(copied, expected, view);
                } else {
                    assert.equal(
                        container.querySelectorAll("button").length,
                        0,
                        "no nested code-block headers or copy buttons",
                    );

                    if (command.rows !== undefined) {
                        const rows = [...container.querySelectorAll("code.text-code")];

                        assert.deepEqual(
                            rows.map((row) => row.textContent),
                            command.rows,
                        );
                        assert.ok(
                            rows.every((row) => row.classList.contains("whitespace-pre-wrap")),
                        );
                    }
                }
            }
        }
    } finally {
        act(() => {
            root.unmount();
        });
        await stop();
    }
});
