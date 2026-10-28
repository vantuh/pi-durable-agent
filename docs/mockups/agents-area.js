// Standalone preview. Sample data only: no API calls, no live agents.

const STORE_KEY = "agents-area:height";
const wide = window.matchMedia("(min-width: 1024px)");

const PARENT = { id: "workspace", title: "Subagent workspace" };

const sessions = [
    { id: "workspace", title: PARENT.title, age: 0 },
    { id: "profile", title: "Profile model validation", age: 2, busy: true },
    { id: "docs", title: "Extension documentation", age: 15 },
    { id: "archive", title: "Session archive notes", age: 180, unseen: true },
    { id: "theme", title: "Theme contrast pass", age: 1500 },
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

const kidIds = {
    none: [],
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
    missing: [],
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

function readState() {
    const params = new URLSearchParams(window.location.search);
    let scenario = params.get("scenario");
    let agent = params.get("agent");

    if (scenario === "child") {
        scenario = "mixed";
        agent ??= "worker";
    }
    if (!["none", "mixed", "many", "missing"].includes(scenario)) {
        scenario = "mixed";
    }

    const kids = kidIds[scenario].map((id) => ({ id, ...catalog[id] }));
    // Working first, then finished, newest first. Creation order breaks ties.
    const ordered = [
        ...kids.filter((kid) => kid.state === "working"),
        ...kids.filter((kid) => kid.state !== "working").toSorted((a, b) => a.age - b.age),
    ];
    const hasParent = scenario === "mixed" || scenario === "many";
    const child = hasParent ? ordered.find((kid) => kid.id === agent) : undefined;
    const sessionParam = sessions.find((s) => s.id === params.get("session"));
    const openOrphan = scenario === "missing" && orphanIds.includes(agent) ? agent : "reviewer";

    let currentId;
    if (scenario === "missing") {
        currentId = openOrphan;
    } else if (hasParent) {
        currentId = PARENT.id;
    } else {
        currentId = sessionParam && sessionParam.id !== PARENT.id ? sessionParam.id : "docs";
    }

    return {
        scenario,
        kids: ordered,
        hasParent,
        child,
        currentId,
        orphan: scenario === "missing",
        openOrphan,
        theme: params.get("theme") === "latte" ? "latte" : "mocha",
        totals: params.get("totals") === "all" ? "all" : "sessions",
        orphanArea: params.get("orphan") === "minimal" ? "minimal" : "none",
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

function sessionRows(state) {
    const rows = sessions
        .filter((s) => !(state.orphan && s.id === PARENT.id))
        .map((s) => ({
            ...s,
            href: hrefWith(
                s.id === PARENT.id
                    ? { scenario: state.hasParent ? state.scenario : "mixed", agent: null }
                    : { scenario: "none", agent: null, session: s.id },
            ),
        }));

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
    const showFull = state.hasParent && state.kids.length > 0;
    const showMinimal = state.orphan && state.orphanArea === "minimal";

    area.hidden = !showFull && !showMinimal;
    area.classList.toggle("minimal", showMinimal);
    if (showFull) {
        area.setAttribute("aria-label", `Agents of ${PARENT.title}`);
        area.innerHTML = `<div class="area-head">
            <h2 class="area-title">Agents of <b>${PARENT.title}</b></h2>
            <span class="area-count">${state.kids.length}</span>
        </div>
        <ul id="area-scroll" class="area-scroll m-0 list-none">${state.kids.map((kid) => agentRow(kid, state)).join("")}</ul>`;
    } else if (showMinimal) {
        area.setAttribute("aria-label", "Parent not found");
        area.innerHTML = `<div class="area-head"><h2 class="area-title"><b>Parent not found</b></h2></div>
        <p class="area-note">The parent session is archived, so its agents stay in the list above.</p>`;
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
        ? (selected?.title ?? PARENT.title)
        : `${agent.title} · ${agent.profile}`;

    $("conversation-title").textContent = title;
    $("conversation-subtitle").textContent = parentView
        ? "pi-durable-agent · main"
        : child
          ? `Agent of ${PARENT.title} · sample conversation`
          : "Agent · its parent session is archived · sample conversation";
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
    back.textContent = `← Back to ${PARENT.title}`;
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

function renderStatus(state) {
    const rows = sessionRows(state).filter((row) => row.id !== state.currentId);
    let working = rows.filter((row) => row.busy).length;
    let fresh = rows.filter((row) => row.unseen).length;
    const hidden = state.kids.filter((kid) => kid.id !== state.child?.id);

    if (state.totals === "all") {
        working += hidden.filter((kid) => kid.state === "working").length;
        fresh += hidden.filter((kid) => kid.unseen).length;
    }

    $("status-working").textContent = working > 0 ? `· ${working} working` : "";
    $("status-new").textContent = fresh > 0 ? `· ${fresh} new` : "";
    $("status-note").textContent =
        state.totals === "sessions"
            ? "totals: sessions only"
            : hidden.length === 0
              ? "totals: + agents (none hidden here)"
              : "totals: sessions + hidden agents";

    const hint = $("collapsed-hint");
    const workingKids = hidden.filter((kid) => kid.state === "working").length;

    hint.hidden = workingKids === 0 || !state.hasParent;
    hint.innerHTML = `<span class="state-mark working text-warn" aria-hidden="true"></span>${workingKids} working`;
    hint.title = `${workingKids} agents working in ${PARENT.title}`;
}

function renderControls(state) {
    const pressed = {
        scenario: state.scenario === "mixed" && state.child ? "child" : state.scenario,
        sidebar: state.sidebar === "closed" ? "closed" : "open",
        totals: state.totals,
        orphan: state.orphanArea,
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

    if (area.hidden || area.classList.contains("minimal")) {
        handle.hidden = true;
        area.style.height = "";
        updateReadout(
            null,
            bounds(),
            area.hidden
                ? "No agents area for this conversation"
                : "Minimal “Parent not found” area · fixed height, not resizable",
        );

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
                    ? { scenario: "mixed", agent: "worker" }
                    : { scenario: value, agent: null },
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
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !wide.matches && $("app").dataset.sidebar === "open") {
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
