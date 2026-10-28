// Standalone preview. Sample data only: no API calls, no live agents.

const STORE_KEY = "agents-area:height";
const wide = window.matchMedia("(min-width: 1024px)");

const PARENTS = {
    workspace: { id: "workspace", title: "Subagent workspace" },
    profile: { id: "profile", title: "Profile model validation" },
    theme: { id: "theme", title: "Theme contrast pass" },
};

const sessions = [
    { id: "workspace", title: PARENTS.workspace.title, age: 0 },
    { id: "profile", title: "Profile model validation", age: 2, busy: true },
    { id: "docs", title: "Extension documentation", age: 15 },
    { id: "archive", title: "Session archive notes", age: 180, unseen: true },
    { id: "theme", title: "Theme contrast pass", age: 45 },
    { id: "cache", title: "Offline shell cache", age: 4300 },
];

const catalog = {
    scout: {
        title: "Scout",
        profile: "scout",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 28,
        task: "Map the session list and its ownership data.",
    },
    worker: {
        title: "Worker",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 42,
        task: "Explore the smallest extension seam above the composer.",
    },
    evidence: {
        title: "Evidence",
        profile: "evidence-auditor",
        model: "Opus 5.5",
        state: "working",
        ctx: 19,
        task: "Verify assumptions about durable task ownership.",
    },
    docs: {
        title: "Docs",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 34,
        task: "Document the approved behavior and its limits.",
    },
    reviewer: {
        title: "Reviewer",
        profile: "reviewer",
        model: "Opus 5.5",
        state: "finished",
        ctx: 76,
        age: 4,
        unseen: true,
        task: "Review navigation, context metrics, and mobile edge cases.",
    },
    mobile: {
        title: "Mobile touch targets and constrained-height layouts",
        profile: "reviewer",
        model: "Opus 5.5",
        state: "finished",
        ctx: 57,
        age: 9,
        unseen: true,
        task: "Check touch targets and constrained-height layouts.",
    },
    types: {
        title: "Types",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 33,
        age: 14,
        task: "Tighten the protocol types for the agent summary.",
    },
    lint: {
        title: "Lint",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 18,
        age: 21,
        task: "Fix the lint findings in the strip.",
    },
    tests: {
        title: "Tests",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 64,
        age: 38,
        task: "Cover the session summary with tests.",
    },
    security: {
        title: "Security",
        profile: "reviewer",
        model: "Opus 5.5",
        state: "finished",
        ctx: 81,
        age: 60,
        task: "Audit the child-conversation routes.",
    },
    migration: {
        title: "Migration",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 47,
        age: 120,
        task: "Draft the parent-link migration.",
    },
    mapper: {
        title: "Mapper",
        profile: "scout",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 22,
        age: 180,
        task: "Map where the session list is filtered.",
    },
};

// A second parent, so the status popover has working agents of more than one parent to list.
Object.assign(catalog, {
    validator: {
        title: "Validator",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 51,
        task: "Validate profile model names against the registry.",
    },
    schema: {
        title: "Schema",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 29,
        age: 25,
        task: "Check the profile frontmatter schema.",
    },
});

Object.assign(catalog, {
    writer: {
        title: "Writer",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 37,
        task: "Draft the theme contrast notes.",
    },
    linker: {
        title: "Linker",
        profile: "scout",
        model: "Sonnet 5.5",
        state: "working",
        ctx: 24,
        task: "Collect the contrast ratios of every role pair.",
    },
    checker: {
        title: "Checker",
        profile: "reviewer",
        model: "Opus 5.5",
        state: "working",
        ctx: 62,
        task: "Check the Latte flavour against the same pairs.",
    },
    indexer: {
        title: "Indexer",
        profile: "worker",
        model: "Sonnet 5.5",
        state: "finished",
        ctx: 41,
        age: 31,
        task: "List the roles that have no contrast data.",
    },
});

// The agents of the two other parents. Their parents are in the list in every scenario; the
// parent with three working agents is Theme contrast pass, the one with one is Profile model
// validation, and Session archive notes has none.
const otherKidIds = {
    profile: ["validator", "schema"],
    theme: ["writer", "linker", "checker", "indexer"],
};

const kidIds = {
    mixed: ["scout", "worker", "reviewer"],
    many: [
        "scout",
        "worker",
        "evidence",
        "docs",
        "reviewer",
        "mobile",
        "types",
        "lint",
        "tests",
        "security",
        "migration",
        "mapper",
    ],
};
const orphanIds = ["reviewer", "scout"];

const $ = (id) => document.getElementById(id);
const sidebar = $("sidebar");
const split = $("split");
const listPane = $("list-pane");
const area = $("agents-area");
const handle = $("area-handle");

function formatAge(minutes) {
    if (minutes < 1) {
        return "now";
    }
    if (minutes < 60) {
        return `${minutes}m`;
    }
    if (minutes < 1440) {
        return `${Math.floor(minutes / 60)}h`;
    }

    return `${Math.floor(minutes / 1440)}d`;
}

// The agents of a parent in the sample world. The workspace's depend on the scenario; the missing
// and none scenarios have none, because there the workspace is gone or has not delegated.
function kidsOf(parentId, scenario) {
    if (parentId === "profile" || parentId === "theme") {
        return otherKidIds[parentId];
    }
    if (parentId !== "workspace") {
        return [];
    }

    return scenario === "many" || scenario === "mixed" || scenario === "other"
        ? kidIds[scenario === "many" ? "many" : "mixed"]
        : [];
}

// Working first, then finished, newest first.
function orderedKids(parentId, scenario) {
    const kids = kidsOf(parentId, scenario).map((id) => ({ id, parentId, ...catalog[id] }));

    return [
        ...kids.filter((kid) => kid.state === "working"),
        ...kids.filter((kid) => kid.state !== "working").toSorted((a, b) => a.age - b.age),
    ];
}

function readState() {
    const params = new URLSearchParams(window.location.search);
    let scenario = params.get("scenario");
    let agent = params.get("agent");

    if (scenario === "child") {
        scenario = "mixed";
        agent ??= "worker";
    }
    if (!["none", "mixed", "many", "other", "missing"].includes(scenario)) {
        scenario = "mixed";
    }

    const parent =
        scenario === "other"
            ? PARENTS[params.get("parent") === "theme" ? "theme" : "profile"]
            : PARENTS.workspace;
    const ordered = orderedKids(parent.id, scenario);
    const hasParent = scenario === "mixed" || scenario === "many" || scenario === "other";
    const child = hasParent ? ordered.find((kid) => kid.id === agent) : undefined;
    const sessionParam = sessions.find((s) => s.id === params.get("session"));
    const openOrphan = scenario === "missing" && orphanIds.includes(agent) ? agent : "reviewer";

    let currentId;
    if (scenario === "missing") {
        currentId = openOrphan;
    } else if (hasParent) {
        currentId = parent.id;
    } else {
        currentId = sessionParam && !(sessionParam.id in PARENTS) ? sessionParam.id : "docs";
    }

    return {
        scenario,
        parent,
        kids: ordered,
        hasParent,
        child,
        currentId,
        orphan: scenario === "missing",
        openOrphan,
        theme: params.get("theme") === "latte" ? "latte" : "mocha",
        finished: params.get("finished") === "check" ? "check" : "dim",
        sidebar: params.get("sidebar") ?? (wide.matches ? "open" : "closed"),
    };
}

function hrefWith(changes) {
    const url = new URL(window.location.href);

    for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, value);
        }
    }

    return `${url.pathname}${url.search}`;
}

function mark(item, finishedStyle) {
    if (item.state === "working") {
        return '<span class="mark-slot"><span class="state-mark working text-warn" role="img" aria-label="Working"></span></span>';
    }
    if (finishedStyle === "check") {
        return `<span class="mark-slot check ${item.unseen ? "text-ok" : "text-faint"}" role="img" aria-label="Finished">✓</span>`;
    }

    return `<span class="mark-slot"><span class="state-mark ${item.unseen ? "fresh text-ok" : "idle text-faint"}" role="img" aria-label="${item.unseen ? "Finished, not viewed" : "Finished"}"></span></span>`;
}

function sessionHref(session, state) {
    if (session.id === "workspace") {
        return hrefWith({
            scenario: state.scenario === "many" ? "many" : "mixed",
            agent: null,
            parent: null,
        });
    }
    if (session.id === "profile" || session.id === "theme") {
        return hrefWith({ scenario: "other", parent: session.id, agent: null });
    }

    return hrefWith({ scenario: "none", agent: null, parent: null, session: session.id });
}

function sessionRows(state) {
    const rows = sessions
        .filter((s) => !(state.orphan && s.id === "workspace"))
        .map((s) => ({ ...s, href: sessionHref(s, state) }));

    if (state.orphan) {
        for (const id of orphanIds) {
            const orphan = catalog[id];

            rows.push({
                id,
                title: orphan.title,
                age: orphan.state === "working" ? 0 : orphan.age,
                busy: orphan.state === "working",
                unseen: orphan.unseen,
                agent: true,
                href: hrefWith({ scenario: "missing", agent: id }),
            });
        }
    }

    return rows.toSorted((a, b) => a.age - b.age);
}

function listRow(row, state) {
    const current = row.id === state.currentId;
    const markClass = row.busy
        ? row.agent
            ? "working text-warn"
            : "working text-accent"
        : row.unseen
          ? "fresh text-ok"
          : "idle text-faint";
    const tip = row.agent
        ? `${row.title}: an agent whose parent session is not in this list`
        : row.title;

    return `<a data-nav class="sess-row ${current ? "is-current" : ""}" href="${row.href}" title="${tip}" ${current ? 'aria-current="page"' : ""}>
        <span class="mark-slot"><span class="state-mark ${markClass}" aria-hidden="true"></span></span>
        <span class="sess-title">${row.title}</span>
        ${row.agent ? '<span class="tag">agent</span>' : ""}
        <span class="sess-time">${formatAge(row.age)}</span>
    </a>`;
}

function renderList(state) {
    const rows = sessionRows(state);
    const today = rows.filter((row) => row.age < 1440);
    const earlier = rows.filter((row) => row.age >= 1440);
    const group = (label, items) =>
        items.length === 0
            ? ""
            : `<div class="group-head">${label} · ${items.length}</div>${items.map((row) => listRow(row, state)).join("")}`;

    listPane.innerHTML = `<nav class="flex flex-col gap-0.5" aria-label="Sessions">${group("Today", today)}${group("Earlier", earlier)}</nav>`;
}

function agentRow(kid, state) {
    const current = state.child?.id === kid.id;
    const check = state.finished === "check";
    const working = kid.state === "working";
    let titleClass = "text-ink";
    let meta;

    if (working) {
        meta = '<span class="agent-meta text-muted">working</span>';
    } else if (check) {
        meta = `<span class="agent-meta font-mono ${kid.ctx > 70 ? "text-warn" : "text-faint"}">${kid.ctx}%</span>`;
    } else {
        titleClass = "text-muted";
        meta = `<span class="agent-meta">finished ${formatAge(kid.age)} ago</span>`;
    }

    const tip = `${kid.title} · ${kid.profile} · ${working ? "working" : `finished ${formatAge(kid.age)} ago, final context ${kid.ctx}%`}`;

    return `<li><a data-nav class="agent-row ${current ? "is-current" : ""}" href="${hrefWith({ agent: kid.id })}" title="${tip}" ${current ? 'aria-current="page"' : ""}>
        ${mark(kid, state.finished)}
        <span class="agent-title ${titleClass}">${kid.title}</span>
        ${meta}
    </a></li>`;
}

function renderArea(state) {
    // No agents, or no parent (a child whose parent is gone is a plain row in the list): no area.
    const show = state.hasParent && state.kids.length > 0;

    area.hidden = !show;
    if (show) {
        area.setAttribute("aria-label", `Agents of ${state.parent.title}`);
        area.innerHTML = `<div class="area-head">
            <h2 class="area-title">Agents of <b>${state.parent.title}</b></h2>
            <span class="area-count">${state.kids.length}</span>
        </div>
        <ul id="area-scroll" class="area-scroll m-0 list-none">${state.kids.map((kid) => agentRow(kid, state)).join("")}</ul>`;
    } else {
        area.innerHTML = "";
    }
}

function renderMain(state) {
    const { child, scenario } = state;
    const orphan = state.orphan ? catalog[state.openOrphan] : undefined;
    const selected = sessions.find((s) => s.id === state.currentId);
    const agent = child ?? orphan;
    const parentView = agent === undefined;
    const title = parentView
        ? (selected?.title ?? state.parent.title)
        : `${agent.title} · ${agent.profile}`;

    $("conversation-title").textContent = title;
    $("conversation-subtitle").textContent = parentView
        ? "pi-durable-agent · main"
        : child
          ? `Agent of ${state.parent.title} · sample conversation`
          : "Agent · its parent session was deleted · sample conversation";
    $("user-message").textContent = parentView
        ? scenario === "none"
            ? "Sample conversation without any agents."
            : "Keep agents separate from my main sessions, and list them under the sidebar."
        : `Orchestrator: ${agent.task}`;
    $("answer-model").textContent = parentView
        ? "gpt-6.1-sol · high"
        : `${agent.model} · profile configuration`;
    $("answer").textContent = parentView
        ? scenario === "none"
            ? "Nothing was delegated here, so the sidebar shows no agents area."
            : "I've split the work into independent tasks. Their reports will come back to this conversation."
        : "This is the agent's own transcript, not the parent's conversation. The real feature shows its instructions, tool calls, and responses here.";
    $("composer-model").innerHTML = parentView
        ? '<span class="text-accent">✧</span> gpt-6.1-sol <span class="text-accent">high</span> ⌄'
        : `<span class="text-accent">✧</span> ${agent.model} ⌄`;

    const back = $("back-to-parent");
    back.hidden = child === undefined;
    back.textContent = `← Back to ${state.parent.title}`;
    back.href = hrefWith({ agent: null });
    back.dataset.nav = "";

    const strip = state.kids.filter((kid) => kid.state === "working");
    $("working-agents").hidden = strip.length === 0 || child !== undefined || !state.hasParent;
    $("agent-count").textContent = `${strip.length} agents working`;
    $("agent-list").innerHTML = strip
        .map(
            (
                kid,
            ) => `<div role="listitem"><a data-nav class="agent-card" href="${hrefWith({ agent: kid.id })}" aria-label="Open ${kid.title}'s conversation" title="${kid.title} · ${kid.profile} · ${kid.model}. Context estimate ${kid.ctx}%.">
            <span class="state-mark working text-warn" role="img" aria-label="Working"></span>
            <div class="min-w-0"><div class="agent-name">${kid.title}</div></div>
            <span class="agent-context" aria-label="Context estimate: ${kid.ctx}%"><span class="meter-track" aria-hidden="true"><span class="meter-fill ${kid.ctx > 70 ? "warn" : ""}" style="width: ${kid.ctx}%"></span></span>${kid.ctx}%</span>
        </a></div>`,
        )
        .join("");
}

// Working agents of every parent that still exists, the open parent's first. The open agent
// itself is left out, like the open session is left out of the session counts.
function workingAgents(state) {
    const parents = [state.parent, ...Object.values(PARENTS).filter((p) => p !== state.parent)];

    return parents
        .flatMap((parent) =>
            orderedKids(parent.id, state.scenario).map((kid) => ({ ...kid, parent })),
        )
        .filter((kid) => kid.state === "working" && kid.id !== state.child?.id);
}

function agentHref(kid, state) {
    if (kid.parentId === "workspace") {
        return hrefWith({
            scenario: state.scenario === "many" ? "many" : "mixed",
            agent: kid.id,
            parent: null,
        });
    }

    return hrefWith({ scenario: "other", parent: kid.parentId, agent: kid.id });
}

// A parent's working agents, as counted by its marker and listed in its submenu. The agent that
// is open is left out, like the open session is left out of the session counts.
function workingKidsOf(parentId, state) {
    return orderedKids(parentId, state.scenario).filter(
        (kid) => kid.state === "working" && kid.id !== state.child?.id,
    );
}

// One row of the popover. A parent with working agents also gets a marker button. It sits beside
// the row's link because a button cannot be inside a link.
function popoverItem(row, state, current) {
    const kids = workingKidsOf(row.id, state);
    const markClass = row.busy
        ? "working text-accent"
        : row.unseen
          ? "fresh text-ok"
          : "idle text-faint";
    const inner = `<span class="mark-slot"><span class="state-mark ${markClass}" aria-hidden="true"></span></span>
        <span class="pop-text"><span class="pop-title">${row.title}</span><span class="pop-sub">pi-durable-agent</span></span>
        <span class="pop-time">${formatAge(row.age)}</span>`;
    const link = current
        ? `<div class="pop-row">${inner}</div>`
        : `<a data-nav class="pop-row" href="${row.href}">${inner}</a>`;
    const marker =
        kids.length === 0
            ? ""
            : `<button type="button" class="pop-marker" aria-haspopup="true" aria-expanded="false" aria-controls="status-submenu" aria-label="${kids.length} ${kids.length === 1 ? "agent" : "agents"} working in ${row.title}"><span class="state-mark working text-warn" aria-hidden="true"></span><span>${kids.length}</span><span class="pop-chev" aria-hidden="true">›</span></button>`;

    return `<div class="pop-item${current ? " is-current" : ""}" data-parent="${row.id}"${kids.length === 0 ? "" : " data-has-agents"}>${link}${marker}</div>`;
}

let popoverState = null;

function renderPopover(state) {
    hideSub();
    popoverState = state;

    const active = sessionRows(state).find((row) => row.id === state.currentId);
    const rows = sessionRows(state).filter((row) => row.id !== state.currentId);
    // Working sessions, and parents whose agents work, come first; then the unseen ones.
    const busy = rows.filter((row) => row.busy === true || workingKidsOf(row.id, state).length > 0);
    const others = [...busy, ...rows.filter((row) => row.unseen && !busy.includes(row))];

    $("status-popover").innerHTML = `${active ? popoverItem(active, state, true) : ""}${others
        .map((row) => popoverItem(row, state, false))
        .join(
            "",
        )}${others.length === 0 ? '<p class="pop-none">No other session is working</p>' : ""}
        <div class="pop-sep" role="separator"></div>
        <button type="button" class="pop-row" data-close title="Opens the home page in the real app; not mocked here"><span class="mark-slot text-muted" aria-hidden="true">⌂</span>All sessions</button>`;
    $("status-popover")
        .querySelectorAll(".pop-item")
        .forEach((item) => {
            // Hover is the mouse's. A touch has no hover; it taps the marker instead.
            item.addEventListener("pointerenter", (event) => {
                if (event.pointerType !== "mouse") {
                    return;
                }
                window.clearTimeout(subTimer);
                if (item.hasAttribute("data-has-agents")) {
                    showSub(item.dataset.parent, "hover");
                } else {
                    scheduleHideSub();
                }
            });
            item.addEventListener("pointerleave", (event) => {
                if (event.pointerType === "mouse") {
                    scheduleHideSub();
                }
            });
        });
}

const submenu = $("status-submenu");
// Who opened the submenu decides what closes it: a hover closes on leave, a focus on focus
// leaving, a tap (or Enter on the marker) only on a second tap, Escape or a click elsewhere.
let sub = null;
let subTimer = 0;
let suppressFocusOpen = false;

function itemFor(parentId) {
    return [...$("status-popover").querySelectorAll(".pop-item")].find(
        (item) => item.dataset.parent === parentId,
    );
}

function hideSub() {
    window.clearTimeout(subTimer);
    sub = null;
    submenu.hidden = true;
    // Out of the row again, so rebuilding the rows does not destroy it.
    $("status-line").append(submenu);
    document.querySelectorAll(".pop-item[data-open]").forEach((item) => {
        delete item.dataset.open;
        item.querySelector(".pop-marker")?.setAttribute("aria-expanded", "false");
    });
}

// Beside the popover if there is room on the right, else beside it on the left, else under the
// row (over the rows below it, or over the row if the window ends first).
function placeSub(item) {
    const margin = 8;
    const gap = 4;
    const box = $("status-popover").getBoundingClientRect();
    const row = item.getBoundingClientRect();

    submenu.style.minWidth = "";
    submenu.style.visibility = "hidden";
    submenu.hidden = false;

    const width = submenu.offsetWidth;
    const height = submenu.offsetHeight;
    let side = "right";
    let left = box.right + gap;
    let top = row.top - 5;

    if (left + width > window.innerWidth - margin) {
        side = "left";
        left = box.left - gap - width;
    }
    if (left < margin) {
        side = "below";
        submenu.style.minWidth = `${row.width}px`;
        left = Math.max(
            margin,
            Math.min(row.left, window.innerWidth - margin - submenu.offsetWidth),
        );
        // No gap: the next row would show through it.
        top = row.bottom;
        if (top + height > window.innerHeight - margin) {
            top = row.top - height;
        }
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - height));
    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
    submenu.dataset.side = side;
    submenu.style.visibility = "";
}

function showSub(parentId, by) {
    window.clearTimeout(subTimer);
    if (sub?.parentId === parentId) {
        return;
    }
    hideSub();

    const item = itemFor(parentId);
    const kids = popoverState === null ? [] : workingKidsOf(parentId, popoverState);

    if (item === undefined || kids.length === 0) {
        return;
    }
    sub = { parentId, by };
    item.dataset.open = "";
    item.querySelector(".pop-marker")?.setAttribute("aria-expanded", "true");
    submenu.setAttribute("aria-label", `Working agents of ${PARENTS[parentId].title}`);
    submenu.innerHTML = `<div class="pop-head"><b>${PARENTS[parentId].title}</b><span>${kids.length} working</span></div>
        <ul class="pop-agents">${kids
            .map(
                (
                    kid,
                ) => `<li><a data-nav class="pop-row pop-agent" href="${agentHref(kid, popoverState)}" title="${kid.title} · ${kid.profile} · ${kid.model}">
            <span class="mark-slot"><span class="state-mark working text-warn" aria-hidden="true"></span></span>
            <span class="pop-title">${kid.title}</span>
        </a></li>`,
            )
            .join("")}</ul>`;
    item.append(submenu);
    placeSub(item);
}

function scheduleHideSub() {
    window.clearTimeout(subTimer);
    if (sub?.by === "hover") {
        subTimer = window.setTimeout(hideSub, 250);
    }
}

function setPopover(open) {
    $("status-popover").hidden = !open;
    $("status-trigger").setAttribute("aria-expanded", String(open));
    if (!open) {
        hideSub();
    }
}

function renderStatus(state) {
    const rows = sessionRows(state).filter((row) => row.id !== state.currentId);
    const working = rows.filter((row) => row.busy);
    const fresh = rows.filter((row) => row.unseen);
    // Agents are their own item. They are never added to the session counts.
    const agents = workingAgents(state);

    $("status-working").textContent = working.length > 0 ? `· ${working.length} working` : "";
    $("status-new").textContent = fresh.length > 0 ? `· ${fresh.length} new` : "";
    $("status-agents").textContent =
        agents.length > 0
            ? `· ${agents.length} ${agents.length === 1 ? "agent" : "agents"} working`
            : "";
    renderPopover(state);
    setPopover(false);

    const hint = $("collapsed-hint");
    const workingKids = state.kids.filter(
        (kid) => kid.state === "working" && kid.id !== state.child?.id,
    ).length;

    hint.hidden = workingKids === 0 || !state.hasParent;
    hint.innerHTML = `<span class="state-mark working text-warn" aria-hidden="true"></span>${workingKids} working`;
    hint.title = `${workingKids} agents working in ${state.parent.title}`;
}

function renderControls(state) {
    const pressed = {
        scenario: state.scenario === "mixed" && state.child ? "child" : state.scenario,
        sidebar: state.sidebar === "closed" ? "closed" : "open",
        finished: state.finished,
    };

    document.querySelectorAll("[data-set]").forEach((button) => {
        button.setAttribute(
            "aria-pressed",
            String(pressed[button.dataset.set] === button.dataset.value),
        );
    });
    $("flavour").value = state.theme;
}

function savedHeight() {
    const value = Number(window.localStorage.getItem(STORE_KEY));

    return value > 0 ? value : null;
}

function bounds() {
    const style = window.getComputedStyle(sidebar);
    const px = (name) => Number.parseFloat(style.getPropertyValue(name));
    const head = px("--area-head");
    const row = px("--agent-row");
    const pad = px("--area-pad");
    const listMin = px("--group-head") + 3 * px("--list-row");
    const min = head + 2 * row + pad;

    return {
        head,
        row,
        pad,
        listMin,
        min,
        max: Math.max(
            min,
            Math.floor(split.getBoundingClientRect().height - px("--handle") - listMin),
        ),
        autoCap: head + 6 * row + pad,
    };
}

function updateReadout(height, b, note) {
    $("readout").textContent =
        height === null
            ? note
            : `Agents area ${height}px (min ${b.min} · max ${b.max}) · list ${listPane.offsetHeight}px (min ${b.listMin}) · ${savedHeight() === null ? "auto size" : "size saved"}`;
}

function setHeight(requested, persist) {
    const b = bounds();
    const height = Math.round(Math.min(b.max, Math.max(b.min, requested)));

    area.style.height = `${height}px`;
    handle.setAttribute("aria-valuemin", String(b.min));
    handle.setAttribute("aria-valuemax", String(b.max));
    handle.setAttribute("aria-valuenow", String(height));
    handle.setAttribute("aria-valuetext", `${height} pixels`);
    if (height <= b.min || height >= b.max) {
        handle.dataset.limit = height <= b.min ? "min" : "max";
    } else {
        delete handle.dataset.limit;
    }
    if (persist) {
        window.localStorage.setItem(STORE_KEY, String(height));
    }
    updateReadout(height, b);
}

function layoutArea() {
    const rows = area.querySelectorAll(".agent-row").length;

    if (area.hidden) {
        handle.hidden = true;
        area.style.height = "";
        updateReadout(null, bounds(), "No agents area for this conversation");

        return;
    }

    if (window.getComputedStyle(sidebar).display === "none") {
        updateReadout(null, bounds(), "Sidebar collapsed · the agents area is inside it");

        return;
    }

    const b = bounds();

    handle.hidden = false;
    setHeight(savedHeight() ?? Math.min(b.head + rows * b.row + b.pad, b.autoCap), false);
}

function render() {
    const state = readState();
    const areaScroll = document.getElementById("area-scroll");
    const keep = { list: listPane.scrollTop, area: areaScroll?.scrollTop ?? 0 };

    document.documentElement.dataset.flavour = state.theme;
    $("app").dataset.sidebar = state.sidebar;
    renderControls(state);
    renderList(state);
    renderArea(state);
    renderMain(state);
    renderStatus(state);
    layoutArea();
    listPane.scrollTop = keep.list;

    const scroller = document.getElementById("area-scroll");

    if (scroller) {
        scroller.scrollTop = keep.area;
        const current = scroller.querySelector(".is-current");

        // scrollIntoView would also scroll the sidebar itself when it is shorter than its contents.
        if (current) {
            const row = current.getBoundingClientRect();
            const box = scroller.getBoundingClientRect();

            if (row.top < box.top) {
                scroller.scrollTop -= box.top - row.top;
            } else if (row.bottom > box.bottom) {
                scroller.scrollTop += row.bottom - box.bottom;
            }
        }
    }
}

function replace(changes) {
    window.history.replaceState(null, "", hrefWith(changes));
    render();
}

document.querySelectorAll("[data-set]").forEach((button) => {
    button.addEventListener("click", () => {
        const { set, value } = button.dataset;

        if (set === "scenario") {
            replace(
                value === "child"
                    ? { scenario: "mixed", agent: "worker", parent: null }
                    : { scenario: value, agent: null, parent: null },
            );
        } else {
            replace({ [set]: value });
        }
    });
});
$("flavour").addEventListener("change", (event) => {
    replace({ theme: event.target.value });
});
$("reset-size").addEventListener("click", () => {
    window.localStorage.removeItem(STORE_KEY);
    layoutArea();
});
$("open-sidebar").addEventListener("click", () => {
    replace({ sidebar: "open" });
});
$("close-sidebar").addEventListener("click", () => {
    replace({ sidebar: "closed" });
});
$("backdrop").addEventListener("click", () => {
    replace({ sidebar: "closed" });
});
$("status-trigger").addEventListener("click", () => {
    setPopover($("status-popover").hidden);
});
const popover = $("status-popover");

function closeSub(returnFocus) {
    const marker = sub === null ? null : itemFor(sub.parentId)?.querySelector(".pop-marker");

    hideSub();
    if (returnFocus && marker) {
        suppressFocusOpen = true;
        marker.focus();
        suppressFocusOpen = false;
    }
}

popover.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const marker = target?.closest(".pop-marker");

    if (target?.closest("[data-close]")) {
        setPopover(false);
    } else if (marker) {
        const parentId = marker.closest(".pop-item").dataset.parent;

        if (sub?.parentId === parentId && sub.by === "tap") {
            hideSub();

            return;
        }
        hideSub();
        showSub(parentId, "tap");
        // Enter or Space on the marker click with no pointer: move into the list.
        if (event.detail === 0) {
            submenu.querySelector("a")?.focus();
        }
    } else if (sub?.by === "tap" && !target?.closest("#status-submenu")) {
        hideSub();
    }
});
popover.addEventListener("focusin", (event) => {
    const item = event.target instanceof Element ? event.target.closest(".pop-item") : null;

    if (suppressFocusOpen) {
        return;
    }
    if (item?.hasAttribute("data-has-agents")) {
        showSub(item.dataset.parent, "focus");
    } else if (sub !== null && sub.by !== "tap") {
        hideSub();
    }
});
popover.addEventListener("focusout", (event) => {
    if (
        sub?.by === "focus" &&
        !(event.relatedTarget instanceof Node && popover.contains(event.relatedTarget))
    ) {
        hideSub();
    }
});
popover.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;

    if (target === null) {
        return;
    }
    if (target.closest("#status-submenu")) {
        const links = [...submenu.querySelectorAll("a")];
        const at = links.indexOf(target.closest("a"));
        const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];

        if (step !== undefined) {
            event.preventDefault();
            links[(at + step + links.length) % links.length]?.focus();
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            closeSub(true);
        }
    } else if (event.key === "ArrowRight") {
        const item = target.closest(".pop-item[data-has-agents]");

        if (item) {
            event.preventDefault();
            showSub(item.dataset.parent, "focus");
            submenu.querySelector("a")?.focus();
        }
    }
});
window.addEventListener("resize", hideSub);
document.addEventListener("click", (event) => {
    if (event.target instanceof Element && !event.target.closest("#status-line")) {
        setPopover(false);
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
        return;
    }
    if (sub !== null) {
        closeSub(popover.contains(document.activeElement));
    } else if (!popover.hidden) {
        setPopover(false);
        $("status-trigger").focus();
    } else if (!wide.matches && $("app").dataset.sidebar === "open") {
        replace({ sidebar: "closed" });
    }
});

document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[data-nav]") : null;

    if (
        !link ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }
    event.preventDefault();

    const url = new URL(link.href);

    // On a phone the drawer closes once a conversation is chosen.
    if (!wide.matches) {
        url.searchParams.set("sidebar", "closed");
    }
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    render();
});
window.addEventListener("popstate", render);
wide.addEventListener("change", render);

let drag = null;

handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
        return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { startY: event.clientY, startHeight: area.offsetHeight };
    document.documentElement.classList.add("resizing-y");
});
handle.addEventListener("pointermove", (event) => {
    if (drag) {
        // The handle is above the area, so dragging up makes the area taller.
        setHeight(drag.startHeight + (drag.startY - event.clientY), true);
    }
});
function endDrag() {
    drag = null;
    document.documentElement.classList.remove("resizing-y");
}
handle.addEventListener("pointerup", endDrag);
handle.addEventListener("pointercancel", endDrag);
handle.addEventListener("dblclick", () => {
    window.localStorage.removeItem(STORE_KEY);
    layoutArea();
});
handle.addEventListener("keydown", (event) => {
    const b = bounds();
    const step = event.shiftKey ? 64 : 16;
    const height = area.offsetHeight;
    const next = {
        ArrowUp: height + step,
        ArrowDown: height - step,
        Home: b.min,
        End: b.max,
    }[event.key];

    if (event.key === "Enter") {
        event.preventDefault();
        window.localStorage.removeItem(STORE_KEY);
        layoutArea();
    } else if (next !== undefined) {
        event.preventDefault();
        setHeight(next, true);
    }
});

new ResizeObserver(layoutArea).observe(split);

const controls = $("controls");
const controlsParam = new URLSearchParams(window.location.search).get("controls");

controls.open = controlsParam === null ? window.innerWidth >= 760 : controlsParam === "1";
controls.addEventListener("toggle", () => {
    window.history.replaceState(null, "", hrefWith({ controls: controls.open ? "1" : "0" }));
});

render();
