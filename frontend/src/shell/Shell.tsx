import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes, useLocation, useMatch } from "react-router";
import { AlertsBell } from "../alerts/AlertsBell";
import { queries } from "../api/queries";
import { AccountMenu } from "../auth/AccountMenu";
import { CrashProbe } from "../components/CrashProbe";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { StatusBanners } from "../components/StatusBanners";
import { FactoryView } from "../factory/FactoryView";
import { MapView } from "../map/MapView";
import { OverviewView } from "../overview/OverviewView";
import { PowerHistorySection } from "../power/PowerHistorySection";
import { PowerView } from "../power/PowerView";
import { useSelectedServer } from "../servers/ServerContext";
import { ServerManagementView } from "../serverManagement/ServerManagementView";
import { ServerSwitcher } from "../servers/ServerSwitcher";
import { AutoPauseView } from "../settings/AutoPauseView";
import { StatusView } from "../status/StatusView";
import { ToAlertSettings, ToApp } from "./ToApp";

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
function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-4">
      <h2 tabIndex={-1} className="sr-only">
        {title}
      </h2>
      {children}
    </div>
  );
}

const TABS = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/power", label: "Power" },
  { to: "/app/factory", label: "Factory" },
  { to: "/app/map", label: "Map" },
  { to: "/app/settings", label: "Settings" },
];

/** ADR-0030: the operator only (hiding it is UX; the backend enforces). */
const SERVERS_TAB: (typeof TABS)[number] = { to: "/app/servers", label: "Servers" };

/**
 * The signed-in app (ADR-0016 item 4), mounted under /app/* so / and future public pages stay
 * free (ADR-0021). Renders inside AuthGate and ServerGate.
 */
export function Shell() {
  const server = useSelectedServer();
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
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (document.activeElement === document.body) pages.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [pathname]);

  return (
    // minmax(0,1fr): an implicit grid column sizes to its content's min-width, so the tab bar
    // would widen the whole app past a phone's width instead of scrolling on its own.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-3">
        {/* min-w-0: a flex item's default min-width is its content, which beats max-w-full, so
            without it the nav never scrolls and a sixth tab (Servers) lands off-screen at 390 px. */}
        {/* Tighter tabs on phones (no gap, px-2.5) so the five standard tabs fit at 390 px;
            an operator's sixth still scrolls. */}
        <nav aria-label="Main" className="-mx-1 flex min-w-0 max-w-full gap-0 overflow-x-auto sm:gap-1">
          {(canManageServers ? [...TABS, SERVERS_TAB] : TABS).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  // Inset focus ring: the nav scrolls sideways at 390 px, which clips an outer one.
                  "inline-flex min-h-[44px] flex-none items-center rounded-md px-2.5 font-medium sm:px-3 no-underline focus-visible:-outline-offset-2",
                  isActive ? "bg-surface-2 text-fg-strong" : "text-muted hover:text-fg-strong",
                ].join(" ")
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
          <ServerSwitcher />
          {/* The bell sits with the account: both are about you, not the game. */}
          <div className="flex items-center gap-2">
            <AlertsBell />
            <AccountMenu />
          </div>
        </div>
      </div>

      {/* Hidden when there's no banner, loading status or error, so it adds no gap. */}
      <div className="grid gap-3 [&:not(:has(p,[role]))]:hidden">
        <Section label="Server banners" probe="banners">
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
            <div key="overview" className="grid gap-5">
              <Section label="Overview" probe="overview">
                <OverviewView />
              </Section>
              <Section label="Server status" probe="status">
                <StatusView />
              </Section>
            </div>
          }
        />
        <Route
          path="power"
          element={
            <Page key="power" title="Power">
              <Section label="Power" probe="power">
                <PowerView />
              </Section>
              <Section label="Power history" probe="power-history">
                {/* Keyed by server: its polls must never carry over to another server's chart. */}
                <PowerHistorySection key={server.id} />
              </Section>
            </Page>
          }
        />
        <Route
          path="factory"
          element={
            <Page key="factory" title="Factory">
              <Section label="Factory" probe="factory">
                <FactoryView />
              </Section>
            </Page>
          }
        />
        <Route
          path="map"
          element={
            <Page key="map" title="Map">
              <Section label="Factory map" probe="map">
                {/* Keyed by server: the first view fits that server's factory. */}
                <MapView key={server.id} />
              </Section>
            </Page>
          }
        />
        <Route
          path="settings"
          element={
            <Page key="settings" title="Settings">
              <Section label="Server settings" probe="settings">
                <AutoPauseView />
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
              <Page key="servers" title="Servers">
                <Section label="Server management" probe="servers">
                  <ServerManagementView />
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
