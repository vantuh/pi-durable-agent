const agents = [
    {
        name: "Scout",
        profile: "scout",
        model: "Sonnet 5.5",
        fill: 28,
        used: "35.8k / 128k",
        rate: "84",
        task: "Map the session list and its ownership data.",
    },
    {
        name: "Worker",
        profile: "worker",
        model: "Sonnet 5.5",
        fill: 42,
        used: "53.8k / 128k",
        rate: "61",
        task: "Explore the smallest extension seam above the composer.",
    },
    {
        name: "Reviewer",
        profile: "reviewer",
        model: "Opus 5.5",
        fill: 76,
        used: "97.3k / 128k",
        rate: null,
        task: "Review navigation, context metrics, and mobile edge cases.",
    },
    {
        name: "Evidence",
        profile: "evidence-auditor",
        model: "Opus 5.5",
        fill: 19,
        used: "24.3k / 128k",
        rate: "47",
        task: "Verify assumptions about durable task ownership.",
    },
    {
        name: "Docs",
        profile: "worker",
        model: "Sonnet 5.5",
        fill: 34,
        used: "43.5k / 128k",
        rate: "73",
        task: "Document the approved behavior and its limits.",
    },
    {
        name: "Mobile",
        profile: "reviewer",
        model: "Opus 5.5",
        fill: 57,
        used: "73.0k / 128k",
        rate: "52",
        task: "Check touch targets and constrained-height layouts.",
    },
];

function update(key, value) {
    const url = new URL(window.location.href);

    url.searchParams.set(key, value);
    if (key === "count") {
        url.searchParams.delete("agent");
    }
    window.history.replaceState(null, "", url);
    render();
}

function render() {
    const params = new URLSearchParams(window.location.search);
    const requested = Number(params.get("count") ?? 3);
    const count = [0, 1, 3, 6].includes(requested) ? requested : 3;
    const current = agents.find((agent) => agent.name === params.get("agent"));
    const showModel = params.get("models") === "1";
    const flavour = params.get("theme") === "latte" ? "latte" : "mocha";
    const list = document.getElementById("agent-list");
    const back = document.getElementById("back-to-parent");
    const parentUrl = new URL(window.location.href);

    parentUrl.searchParams.delete("agent");
    document.documentElement.dataset.flavour = flavour;
    document.body.toggleAttribute("data-show-model", showModel);
    document.getElementById("show-model").checked = showModel;
    document.getElementById("flavour").value = flavour;
    document.querySelectorAll("[data-count]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.count) === count));
    });
    document.getElementById("working-agents").hidden = count === 0 || current !== undefined;
    document.getElementById("agent-count").textContent =
        `${count} ${count === 1 ? "agent" : "agents"} working`;
    list.innerHTML = agents
        .slice(0, count)
        .map((agent) => {
            const url = new URL(parentUrl);

            url.searchParams.set("agent", agent.name);

            return `<div role="listitem"><a class="agent-card" href="${url.pathname}${url.search}" aria-label="Open ${agent.name}'s conversation" title="${agent.name} · ${agent.profile} · ${agent.model}. Context estimate: ${agent.used} (${agent.fill}%). ${agent.rate === null ? "No completed response yet." : `${agent.rate} output tokens/s over the last completed response, not live speed.`}">
            <span class="state-mark working text-warn" role="img" aria-label="Working"></span>
            <div class="min-w-0"><div class="agent-name">${agent.name}</div><div class="agent-model">${agent.model}</div></div>
            <span class="agent-context" aria-label="Context estimate: ${agent.fill}%"><span class="meter-track" aria-hidden="true"><span class="meter-fill ${agent.fill > 70 ? "warn" : ""}" style="width: ${agent.fill}%"></span></span>${agent.fill}%</span>
            <span class="agent-rate">${agent.rate ?? "—"} tok/s</span>
            <span class="agent-open" aria-hidden="true">↗</span>
        </a></div>`;
        })
        .join("");

    back.hidden = current === undefined;
    back.href = `${parentUrl.pathname}${parentUrl.search}`;
    document.getElementById("conversation-title").textContent =
        current === undefined ? "Subagent workspace" : `${current.name} · ${current.profile}`;
    document.getElementById("conversation-subtitle").textContent =
        current === undefined
            ? "pi-durable-agent · main"
            : "Subagent of Subagent workspace · sample conversation";
    document.getElementById("user-message").textContent =
        current === undefined
            ? "Keep subagents separate from my main sessions. I want to see who's working without leaving this conversation."
            : `Orchestrator: ${current.task}`;
    document.getElementById("answer-model").textContent =
        current === undefined ? "gpt-6.1-sol · high" : `${current.model} · profile configuration`;
    document.getElementById("answer").textContent =
        current === undefined
            ? "I've split the work into independent tasks. You can keep working here while the agents investigate. Their reports will come back to this conversation."
            : "This is the child's own transcript, not the parent's conversation. In the real feature you will see its instructions, tool calls, and responses here. This navigation preview uses sample data only.";
    document.getElementById("activity").textContent =
        current === undefined
            ? count === 0
                ? "No agents working · the status area is completely hidden"
                : `Started ${count} agents · working independently`
            : "Reading project files · working";
    document.getElementById("composer-model").textContent =
        current === undefined ? "✧ gpt-6.1-sol · high ⌄" : `✧ ${current.model} ⌄`;
}

document.querySelectorAll("[data-count]").forEach((button) => {
    button.addEventListener("click", () => {
        update("count", button.dataset.count);
    });
});
document.getElementById("show-model").addEventListener("change", (event) => {
    update("models", event.target.checked ? "1" : "0");
});
document.getElementById("flavour").addEventListener("change", (event) => {
    update("theme", event.target.value);
});
render();
