import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router";
import { AccountMenu } from "../auth/AccountMenu";
import { CrashProbe } from "../components/CrashProbe";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { StatusBanners } from "../components/StatusBanners";
import { FactoryView } from "../factory/FactoryView";
import { OverviewView } from "../overview/OverviewView";
import { PowerView } from "../power/PowerView";
import { ServerSwitcher } from "../servers/ServerSwitcher";
import { AutoPauseView } from "../settings/AutoPauseView";
import { StatusView } from "../status/StatusView";
import { ToApp } from "./ToApp";

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
      <h2 className="sr-only">{title}</h2>
      {children}
    </div>
  );
}

const TABS = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/power", label: "Power" },
  { to: "/app/factory", label: "Factory" },
  { to: "/app/settings", label: "Settings" },
];

/**
 * The signed-in app (ADR-0016 item 4), mounted under /app/* so / and future public pages stay
 * free (ADR-0021). Renders inside AuthGate and ServerGate.
 */
export function Shell() {
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-3">
        <nav aria-label="Main" className="-mx-1 flex max-w-full gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "inline-flex min-h-11 flex-none items-center rounded-md px-3 font-medium no-underline",
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
          <AccountMenu />
        </div>
      </div>

      {/* Hidden when there's no banner, loading status or error, so it adds no gap. */}
      <div className="grid gap-3 [&:not(:has(p,[role]))]:hidden">
        <Section label="Server banners" probe="banners">
          <StatusBanners />
        </Section>
      </div>

      {/* Each page has its own key: pages share a component shape, so without one React would
          reuse the last page's section boundaries, and a crash on one tab would stick to the
          next tab opened. */}
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
          path="settings"
          element={
            <Page key="settings" title="Settings">
              <Section label="Server settings" probe="settings">
                <AutoPauseView />
              </Section>
            </Page>
          }
        />
        <Route path="*" element={<ToApp />} />
      </Routes>
    </div>
  );
}
