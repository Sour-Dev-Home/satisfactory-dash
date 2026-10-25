import {
  Component,
  lazy,
  useCallback,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Route, Routes, useLocation, useMatch } from "react-router";
import { AccountSettings } from "../account/AccountSettings";
import { AgentSettings } from "../agent/AgentSettings";
import { YourServersSection } from "../selfServe/YourServersSection";
import { useYourServer } from "../selfServe/useYourServer";
import { AlertsBell } from "../alerts/AlertsBell";
import { queries } from "../api/queries";
import { AccountMenu } from "../auth/AccountMenu";
import { CrashProbe } from "../components/CrashProbe";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { StatusBanners } from "../components/StatusBanners";
import { FactoryView } from "../factory/FactoryView";
import { MapView } from "../map/MapView";
import { MetricsLink } from "../metrics/MetricsLink";
import { MetricsView } from "../metrics/MetricsView";
import { OverviewView } from "../overview/OverviewView";
import { PlannerView } from "../planner/PlannerView";
import { isPaletteShortcut } from "../palette/paletteCommands";
import { PowerHistorySection } from "../power/PowerHistorySection";
import { PowerView } from "../power/PowerView";
import { BasicDataGate } from "../components/BasicData";
import { LeftStatus } from "../servers/LeftStatus";
import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { ServerManagementView } from "../serverManagement/ServerManagementView";
import { ServerSwitcher } from "../servers/ServerSwitcher";
import { AutoPauseView } from "../settings/AutoPauseView";
import { AlertSettings } from "../alerts/settings/AlertSettings";
import { StatusView } from "../status/StatusView";
import { cn } from "../lib/cn";
import { chipButton } from "../ui/chip";
import { PageReveal } from "../ui/PageReveal";
import { ToAlertSettings, ToApp } from "./ToApp";
import { navFadeClass, revealActiveTab } from "./navFade";
import { whenIdle } from "../lib/idle";
import { pageQueries, paletteQueries, prefetchFresh } from "./pageQueries";
import { visibleTabs } from "./tabs";

type PaletteModule = { default: ComponentType<{ onDone: () => void }> };

// cmdk is only needed once the bar opens (#387): its own chunk, loaded on the first Ctrl+K or click.
const loadPalette = (): Promise<PaletteModule> =>
  import("../palette/CommandBar").then((m) => ({ default: m.Palette }));

/**
 * The command bar (#351): Ctrl+K / Cmd+K anywhere in the app, or the header's Search button, opens a
 * search over pages, settings, circuits, machines and items, and Enter jumps there. Modal by
 * convention (the owner's exception to ADR-0016 item 8). The dialog is a native <dialog> opened with
 * showModal(): a real modal (the page behind is inert; Esc closes), with no library dialog, because
 * Radix Dialog's scroll lock injects a <style> element that the CSP (style-src 'self') blocks. The
 * search inside (`palette/CommandBar.tsx`, cmdk) is its own chunk: preloaded once the app is idle (not
 * under Save-Data or 2G, `lib/idle.ts`), and on hover or focus of the Search button, which also starts
 * the search's reads; otherwise it loads on the first open. Focus goes back where it was on close.
 * `load` and `preload` are for tests.
 */
export function CommandBar({
  load = loadPalette,
  preload = whenIdle,
}: {
  load?: () => Promise<PaletteModule>;
  preload?: (task: () => void) => () => void;
}) {
  const [open, setOpen] = useState(false);
  // One import at a time, shared by the preload, the hover and the bar; a failure clears it, so the next try imports afresh.
  const inFlight = useRef<Promise<PaletteModule> | null>(null);
  const [loadOnce] = useState(() => (): Promise<PaletteModule> => {
    inFlight.current ??= load().catch((error: unknown) => {
      inFlight.current = null;
      throw error;
    });
    return inFlight.current;
  });
  // React.lazy keeps a failed import for good, so a failure swaps in a fresh one to import again.
  const [Palette, setPalette] = useState(() => lazy(loadOnce));
  const server = useSelectedServer();
  const client = useQueryClient();
  // A failed preload says nothing: opening the bar tries again and shows the error there.
  const warmChunk = useCallback(() => void loadOnce().catch(() => {}), [loadOnce]);
  const warm = () => {
    warmChunk();
    prefetchFresh(client, paletteQueries(server.id));
  };
  useEffect(() => preload(warmChunk), [preload, warmChunk]);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Where focus was, taken as the bar opens: by the time an effect runs, the search box has it.
  const rememberFocus = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const openBar = () => {
    rememberFocus();
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      if (!dialog.current?.hasAttribute("open")) rememberFocus();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // The attribute, not `el.open`: the same in every browser, and set even where showModal isn't.
    const shown = el.hasAttribute("open");
    if (open && !shown) {
      // jsdom has no showModal; the attribute is the same dialog, just not modal.
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && shown) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
      returnFocus.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openBar}
        onPointerEnter={warm}
        onFocus={warm}
        aria-label="Search (Ctrl+K)"
        title="Search (Ctrl+K)"
        aria-haspopup="dialog"
        className={cn(chipButton, "min-w-touch justify-center px-0")}
      >
        <SearchIcon />
      </button>
      <dialog
        ref={dialog}
        aria-label="Search"
        // Esc: the browser closes a modal dialog itself; keep the state in step.
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
        // The browser's own dialog styles cap the width with a margin, so a phone keeps its gutter.
        className="mx-auto mt-16 w-palette animate-pop rounded-card border border-line bg-surface p-0 text-fg shadow-lg backdrop:bg-scrim backdrop:backdrop-blur-sm max-sm:mt-4"
      >
        {open && (
          <PaletteBoundary onError={() => setPalette(() => lazy(loadOnce))}>
            <Suspense fallback={<PaletteLoading />}>
              <Palette onDone={() => setOpen(false)} />
            </Suspense>
          </PaletteBoundary>
        )}
      </dialog>
    </>
  );
}

/** Holds the search box's row while the chunk loads, so the dialog doesn't jump when it arrives. */
function PaletteLoading() {
  return (
    <p
      role="status"
      data-palette-loading=""
      className="flex min-h-touch items-center border-b border-line px-4 text-sm text-muted motion-safe:animate-pulse"
    >
      Loading search…
    </p>
  );
}

/**
 * The palette's chunk failed to load (offline, usually). It says so and offers Try again, inside
 * the dialog. It never reloads the page: unlike a section's ErrorBoundary it doesn't call #325's
 * reloadOnce, and offline a reload would only swap the app for the browser's offline page.
 */
class PaletteBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Search] failed to load", error, info.componentStack);
    this.props.onError();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid gap-3 p-4 text-sm">
        <p>Search couldn't load. Check your connection, then try again.</p>
        <button type="button" autoFocus onClick={() => this.setState({ failed: false })} className="justify-self-start">
          Try again
        </button>
      </div>
    );
  }
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="search"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

/** One boundary per section: a crash in one leaves the rest of the page working. */
function Section({ label, probe, children }: { label: string; probe: string; children: ReactNode }) {
  return (
    <ErrorBoundary label={label}>
      <CrashProbe section={probe} />
      {children}
    </ErrorBoundary>
  );
}

/**
 * A page under a tab. The heading is for screen readers; the active tab shows it visually.
 * Not a landmark itself: its panel already is one, with the same name.
 */
// Each page is revealed once when its tab opens (the key remounts it, #494): its panels load at
// once but show together, as soon as the page's primary queries have answered or the budget is up
// (ui/usePageReveal). The heading stays outside the hidden part so focus can land on it at once.
function Page({
  title,
  path,
  onRevealed,
  gap = "gap-4",
  children,
}: {
  /** The screen-reader heading; left out when the page's own panel already has the h2 (Overview). */
  title?: string;
  /** The tab's path, for its primary queries. */
  path: string;
  onRevealed: () => void;
  gap?: string;
  children: ReactNode;
}) {
  const server = useSelectedServer();
  return (
    <div className="grid gap-4">
      {title && (
        <h2 tabIndex={-1} className="sr-only">
          {title}
        </h2>
      )}
      <PageReveal queries={pageQueries(path, server.id)} scope={server.id} onRevealed={onRevealed} className={cn("grid", gap)}>
        {children}
      </PageReveal>
    </div>
  );
}

/**
 * The signed-in app (ADR-0016 item 4), mounted under /app/* so / and future public pages stay
 * free (ADR-0021). Renders inside AuthGate and ServerGate.
 */
export function Shell() {
  const server = useSelectedServer();
  const { leftName, clearLeft } = useServerSwitch();
  const yourServer = useYourServer();
  // ServerGate already loaded the list; this reads the same cache entry.
  const canManageServers = useQuery(queries.servers()).data?.canManageServers === true;
  const pages = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const onOverview = useMatch("/app") !== null;
  const shownPath = useRef(pathname);
  // A link that navigates away from itself (an Overview row) is removed with its page, which
  // drops focus to <body>. Then move it to the new page's heading, so keyboard and screen
  // reader users continue from there. Not on first load (compared by path, so StrictMode's
  // repeated mount effect doesn't count as a navigation), and not when focus is still on
  // something (a tab link survives the navigation).
  // A page's own heading (Overview's) is hidden until the page is revealed, and a hidden element
  // can't take focus; so the move is also tried when the page reveals (`onRevealed`), until it lands.
  const focusPending = useRef(false);
  const focusHeading = useCallback(() => {
    if (!focusPending.current) return;
    if (document.activeElement !== document.body) {
      focusPending.current = false;
      return;
    }
    const heading = pages.current?.querySelector<HTMLElement>("h2");
    heading?.focus();
    if (heading && document.activeElement === heading) focusPending.current = false;
  }, []);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    focusPending.current = true;
    focusHeading();
  }, [pathname, focusHeading]);

  // A phone's tab bar scrolls sideways: fade the end(s) it can still scroll to, and keep the active tab in view.
  const nav = useRef<HTMLElement>(null);
  const [navFade, setNavFade] = useState("");
  const measureNav = useCallback(() => {
    const el = nav.current;
    if (el) setNavFade(navFadeClass(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);
  useEffect(() => {
    measureNav();
    const el = nav.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureNav);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureNav, canManageServers]);
  useEffect(() => {
    revealActiveTab(nav.current);
  }, [pathname, canManageServers]);

  // Instant tab changes (#494): hovering or focusing a tab starts its page's primary queries, so
  // by the click they are usually cached. Same options as the page's own, so same cache entries.
  const client = useQueryClient();
  const prefetch = (path: string) => {
    if (path !== pathname) prefetchFresh(client, pageQueries(path, server.id));
  };

  return (
    // minmax(0,1fr): an implicit grid column sizes to its content's min-width, so the tab bar
    // would widen the whole app past a phone's width instead of scrolling on its own.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {/* relative: the bell's dropdown is positioned against this row, so it lines up with the page edge. */}
      {/* items-end and no bottom padding: the active tab's amber underline sits on the row's line,
          and the controls keep their own gap above it. */}
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        {/* min-w-0: a flex item's default min-width is its content, which beats max-w-full, so
            without it the nav never scrolls and a sixth tab (Servers) lands off-screen at 390 px. */}
        {/* Tighter tabs on phones (no gap, px-1.5, no letter-spacing) so the six standard tabs (Planner made
            them six) fit at 390 px, the last one whole instead of cut by the fade; an operator's seventh
            still scrolls. -mx-1.5 cancels px-1.5, so the first label stays on the page's text edge. */}
        <nav
          ref={nav}
          aria-label="Main"
          onScroll={measureNav}
          className={cn("-mx-1.5 flex min-w-0 max-w-full gap-0 overflow-x-auto sm:-mx-1 sm:gap-1", navFade)}
        >
          {visibleTabs(canManageServers).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              onMouseEnter={() => prefetch(tab.to)}
              onFocus={() => prefetch(tab.to)}
              onTouchStart={() => prefetch(tab.to)}
              className={({ isActive }) =>
                cn(
                  // Inset focus ring: the nav scrolls sideways at 390 px, which clips an outer one.
                  // The display face and capitals come from index.css (nav[aria-label="Main"] a); the
                  // active tab carries an amber underline (#444), eased in and out by the motion tokens.
                  "inline-flex min-h-touch flex-none items-center border-b-2 px-1.5 font-semibold max-sm:tracking-normal sm:px-3 no-underline transition-colors focus-visible:-outline-offset-2",
                  isActive ? "border-accent text-fg-strong" : "border-transparent text-muted hover:border-line hover:text-fg-strong",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 pb-2">
          <ServerSwitcher />
          {/* The bell sits with the account: both are about you, not the game. */}
          <div className="flex items-center gap-2">
            {/* Search (#351): Ctrl+K / Cmd+K anywhere, or this button on touch. */}
            <CommandBar />
            <AlertsBell />
            <AccountMenu />
          </div>
        </div>
      </div>

      {/* Hidden when there's no banner, loading status or error, so it adds no gap. */}
      <div className="grid gap-3 [&:not(:has(p,[role]))]:hidden">
        <Section label="Server banners" probe="banners">
          {/* ADR-0047: after leaving a server, the gate selected the one left; say so here, where focus lands. */}
          {leftName !== null && <LeftStatus key={server.id} name={leftName} focus onDone={clearLeft} />}
          {/* The owner's call: on the Overview, its Server row carries "paused". */}
          <StatusBanners showPaused={!onOverview} />
        </Section>
      </div>

      {/* Each page has its own key: pages share a component shape, so without one React would
          reuse the last page's section boundaries, and a crash on one tab would stick to the
          next tab opened. */}
      <div ref={pages}>
      <Routes>
        <Route
          index
          element={
            <Page key="overview" path="/app" gap="gap-5" onRevealed={focusHeading}>
              <Section label="Overview" probe="overview">
                <OverviewView />
              </Section>
              <Section label="Server status" probe="status">
                <StatusView />
              </Section>
            </Page>
          }
        />
        <Route
          path="power"
          element={
            <Page key="power" title="Power" path="/app/power" onRevealed={focusHeading}>
              <BasicDataGate>
                <Section label="Power" probe="power">
                  <PowerView />
                </Section>
                <Section label="Power history" probe="power-history">
                  {/* Keyed by server: its polls must never carry over to another server's chart. */}
                  <PowerHistorySection key={server.id} />
                </Section>
              </BasicDataGate>
            </Page>
          }
        />
        <Route
          path="factory"
          element={
            <Page key="factory" title="Factory" path="/app/factory" onRevealed={focusHeading}>
              <BasicDataGate>
                <Section label="Factory" probe="factory">
                  <FactoryView />
                </Section>
              </BasicDataGate>
            </Page>
          }
        />
        {/* ADR-0050: always routed; listed in the nav, prefetch and command bar while PLANNER_IN_NAV (shell/tabs.ts). */}
        <Route
          path="planner"
          element={
            <Page key="planner" title="Planner" path="/app/planner" onRevealed={focusHeading}>
              <BasicDataGate>
                <Section label="Production planner" probe="planner">
                  {/* Keyed by server: a site opened on one server must not follow the user to another. */}
                  <PlannerView key={server.id} />
                </Section>
              </BasicDataGate>
            </Page>
          }
        />
        <Route
          path="map"
          element={
            <Page key="map" title="Map" path="/app/map" onRevealed={focusHeading}>
              <BasicDataGate>
                <Section label="Factory map" probe="map">
                  {/* Keyed by server: the first view fits that server's factory. */}
                  <MapView key={server.id} />
                </Section>
              </BasicDataGate>
            </Page>
          }
        />
        <Route
          path="settings"
          element={
            <Page key="settings" title="Settings" path="/app/settings" onRevealed={focusHeading}>
              <Section label="Server settings" probe="settings">
                {/* Keyed by server: a change still on its way to one server's game PC must not follow
                    the user to another server. */}
                <AutoPauseView key={server.id} />
              </Section>
              <Section label="Game PC agent" probe="agent">
                {/* Keyed by server: an enrolment code is for one server and must never follow the user. */}
                <AgentSettings key={server.id} />
              </Section>
              {yourServer.visible && (
                <Section label="Your server" probe="your-server">
                  {/* Keyed by server: a half-typed delete confirmation must not follow the user to another server. */}
                  <YourServersSection key={server.id} />
                </Section>
              )}
              <Section label="Alert settings" probe="alert-settings">
                <AlertSettings />
              </Section>
              <Section label="Your account" probe="account">
                {/* Keyed by server: a half-open "Leave" confirm must not follow the user to another server. */}
                <AccountSettings key={server.id} />
              </Section>
            </Page>
          }
        />
        {/* The alerts page became the bell's dropdown plus a section on Settings: an old link lands there. */}
        <Route path="alerts" element={<ToAlertSettings />} />
        {canManageServers && (
          <Route
            path="servers"
            element={
              <Page key="servers" title="Servers" path="/app/servers" onRevealed={focusHeading}>
                <Section label="Server management" probe="servers">
                  <ServerManagementView />
                </Section>
                <MetricsLink />
              </Page>
            }
          />
        )}
        {/* ADR-0056: operator only and never in the real nav (shell/tabs.ts). Anyone else gets the unknown-page redirect below. */}
        {canManageServers && (
          <Route
            path="metrics"
            element={
              <Page key="metrics" title="Metrics" path="/app/metrics" onRevealed={focusHeading}>
                <Section label="Metrics" probe="metrics">
                  <MetricsView />
                </Section>
              </Page>
            }
          />
        )}
        <Route path="*" element={<ToApp />} />
      </Routes>
      </div>
    </div>
  );
}
