import { SquareTerminal } from "lucide-react";

import { callAction } from "@/sdk/actions.ts";
import type { FolderMenuItem, WebExtension } from "@/sdk/types.ts";

import { TERMINAL_PAGE, create } from "./refs.ts";
import { FolderTerminals } from "./web/folder-button.tsx";
import { TerminalButton } from "./web/header-button.tsx";
import { HomeTerminals } from "./web/home-group.tsx";
import { TerminalPage } from "./web/page.tsx";
import { refreshFolderTabs } from "./web/use-folder-tabs.ts";

/** A new shell in the session's folder, and the Terminal page open on it. The session menu's item is the same. */
const newTerminal: FolderMenuItem = {
    id: "new",
    label: "New terminal",
    icon: <SquareTerminal className="size-4" />,
    run: async (session, openPage) => {
        const tab = await callAction(create, undefined, session);

        openPage(TERMINAL_PAGE, String(tab));
        void refreshFolderTabs();
    },
};

export default {
    pages: [
        {
            id: TERMINAL_PAGE,
            title: "Terminal",
            icon: <SquareTerminal className="size-4" />,
            tab: false,
            component: TerminalPage,
        },
    ],
    // Before Git history's badge: folder order alone would put it after.
    header: [{ id: "open", order: -1, component: TerminalButton }],
    sidebarFolder: [{ id: "tabs", component: FolderTerminals }],
    home: [{ id: "tabs", component: HomeTerminals }],
    folderMenu: [newTerminal],
    sessionMenu: [newTerminal],
} satisfies WebExtension;
