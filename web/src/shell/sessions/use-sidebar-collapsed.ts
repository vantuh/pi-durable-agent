import { useState } from "react";

import { useShellCommand } from "@/sdk/commands.ts";

const COLLAPSED_KEY = "sidebarCollapsed";

export function useSidebarCollapsed() {
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
    const toggleCollapsed = (): void => {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
        setCollapsed(!collapsed);
    };
    const expand = (): void => {
        localStorage.setItem(COLLAPSED_KEY, "0");
        setCollapsed(false);
    };

    useShellCommand("sidebar.toggle", toggleCollapsed);

    return { collapsed, toggleCollapsed, expand };
}
