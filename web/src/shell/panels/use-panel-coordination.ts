import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useExtensionsLoaded, usePages, usePanels } from "@/extensions.ts";
import type { RouteNavigation } from "@/lib/route.ts";
import { restoreComposerFocus, focusComposer } from "@/sdk/composer.ts";

import { pageKey } from "./pages.tsx";
import { panelKey, useOpenPanel } from "./panels.tsx";

/**
 * What is open beside the conversation: an extension's panel in the drawer, or a page that fills the conversation
 * area, and where the keyboard goes when either closes.
 */
export function usePanelCoordination({ route, openPage, closePage, dropPage }: RouteNavigation) {
    const current = route.session;
    const panels = usePanels();
    const pages = usePages();
    const extensionsLoaded = useExtensionsLoaded();
    const {
        shown: panelShown,
        last: panelLast,
        open: panelOpen,
        setOpen: setPanelOpen,
        forget: forgetPanel,
    } = useOpenPanel(current);
    // A panel may fill the conversation instead of the drawer; it is the visit's choice, so another tab
    // opens the same way and only closing the panel or leaving the session drops it.
    const [expanded, setExpanded] = useState<{ session: number | null } | null>(null);

    // A session change starts in the drawer, even one coming back to a session that was expanded: an open
    // panel is remembered per session, so the mode must not outlive the visit that asked for it. Adjusted
    // during render, as React asks: the state is only ever wrong for the render that sees the change.
    if (expanded !== null && expanded.session !== current) {
        setExpanded(null);
    }
    const tabPages = useMemo(() => pages.filter((candidate) => candidate.tab !== false), [pages]);
    const panel = panels.find((candidate) => panelKey(candidate) === panelShown);
    const openPageItem =
        route.page === null
            ? undefined
            : pages.find((candidate) => pageKey(candidate) === route.page?.key);
    const pageOpen = openPageItem !== undefined;
    const panelExpanded =
        panelOpen &&
        !pageOpen && // a page reached by browser Back while the panel was open is not made inert by it
        expanded !== null &&
        expanded.session === current;
    // Closing the panel drops the mode with it, so reopening it comes back to the drawer.
    const closePanel = useCallback(() => {
        setPanelOpen(null);
        setExpanded(null);
    }, [setPanelOpen]);
    const setPanelExpanded = useCallback(
        (value: boolean) => {
            setExpanded(value ? { session: current } : null);
        },
        [current],
    );

    // The address may name a page no folder answers — turned off, or a typo. Once the folders are in,
    // the address is rewritten to the conversation instead of keeping a frame with nothing in it.
    useEffect(() => {
        if (extensionsLoaded && route.page !== null && openPageItem === undefined) {
            dropPage();
        }
    }, [extensionsLoaded, route.page, openPageItem, dropPage]);
    // The page hides the conversation's controls; on the way out the keyboard goes back to the composer,
    // or, when a panel tab took its place, to that tab.
    const pendingFocus = useRef<"composer" | "tab" | null>(null);
    const hadPage = useRef(false);

    useEffect(() => {
        if (pageOpen) {
            hadPage.current = true;
            return;
        }

        if (!hadPage.current) {
            return;
        }

        hadPage.current = false;

        const asked = pendingFocus.current;
        const lost = document.activeElement === null || document.activeElement === document.body;

        pendingFocus.current = null;

        if (asked === "tab") {
            document.querySelector<HTMLElement>('[data-slot="panel-host"] [aria-current]')?.focus();
            return;
        }

        // Back out of the page leaves focus on nothing; a moved-away session keeps its own focus.
        if (asked === "composer" || lost) {
            focusComposer();
        }
    }, [pageOpen]);

    // A panel that closes, or shrinks from the whole conversation to the drawer, takes the keyboard with it; the
    // page's exit above does the same for a page. A field still focused in the panel keeps the caret.
    const panelBefore = useRef({ open: false, expanded: false });

    useEffect(() => {
        const after = { open: panelOpen, expanded: panelExpanded };
        const before = panelBefore.current;
        const released = (before.open && !after.open) || (before.expanded && !after.expanded);

        panelBefore.current = after;

        if (released) {
            restoreComposerFocus("close");
        }
    }, [panelOpen, panelExpanded]);

    const leavePage = useCallback(() => {
        pendingFocus.current = "composer";
        // Leaving by the page's own close or the toggle also forgets the panel, so it does not come back under it.
        closePanel();
        closePage();
    }, [closePanel, closePage]);
    // A page without a tab does not light the sidebar's button: it is no part of the sidebar.
    const sidebarOpen =
        (pageOpen && openPageItem.tab !== false) || (panelOpen && panel !== undefined);
    const selectPanel = useCallback(
        (key: string) => {
            if (pageOpen) {
                pendingFocus.current = "tab";
            }

            closePage();
            setPanelOpen(key);
        },
        [pageOpen, closePage, setPanelOpen],
    );
    const selectPage = useCallback(
        (key: string) => {
            if (route.page?.key !== key) {
                closePanel();
                openPage(key);
            }
        },
        [route.page?.key, closePanel, openPage],
    );
    // A header item's page, at its own sub-location: the same step as a tab, but already being on the page
    // is no reason to stay at its current sub.
    const openFromHeader = useCallback(
        (key: string, sub?: string) => {
            closePanel();
            openPage(key, sub);
        },
        [closePanel, openPage],
    );
    // Closed, it brings back the panel opened last, else the first panel, else the first tabbed page.
    const toggleSidebar = (): void => {
        if (sidebarOpen) {
            leavePage();
            return;
        }

        const first = panels.find((candidate) => panelKey(candidate) === panelLast) ?? panels[0];

        if (first !== undefined) {
            selectPanel(panelKey(first));
        } else if (tabPages[0] !== undefined) {
            openPage(pageKey(tabPages[0]));
        }
    };

    return {
        panels,
        tabPages,
        panel,
        panelShown,
        panelOpen,
        panelExpanded,
        pageOpen,
        openPageItem,
        sidebarOpen,
        closePanel,
        setPanelExpanded,
        forgetPanel,
        leavePage,
        selectPanel,
        selectPage,
        openFromHeader,
        toggleSidebar,
    };
}
