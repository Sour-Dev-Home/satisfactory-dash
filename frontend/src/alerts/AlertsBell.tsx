import { Component, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { queries } from "../api/queries";
import { cn } from "../lib/cn";
import { useSelectedServer } from "../servers/ServerContext";

/**
 * The header's way to the Alerts page (the owner's call: a bell, not a sixth tab, so the five tabs
 * still fit at 390 px). The badge counts the selected server's firing alerts. It's decoration on
 * every page, so it never gets in the way: while loading, on any error (a 403, a 404, a dead
 * backend) or with nothing firing it shows no badge, and a crash hides only the badge.
 */
export function AlertsBell() {
  return (
    <NavLink
      to="/app/alerts"
      className={({ isActive }) =>
        cn(
          "relative inline-flex size-11 flex-none items-center justify-center rounded-md no-underline focus-visible:-outline-offset-2",
          isActive ? "bg-surface-2 text-fg-strong" : "text-muted hover:text-fg-strong",
        )
      }
    >
      <BellIcon />
      <BadgeBoundary fallback={<span className="sr-only">Alerts</span>}>
        <FiringBadge />
      </BadgeBoundary>
    </NavLink>
  );
}

/** The accessible name and the visible count, from the status the Alerts page also reads. */
function FiringBadge() {
  const server = useSelectedServer();
  const status = useQuery(queries.alertStatus(server.id));
  const firing = status.isSuccess ? status.data.firing.length : 0;
  if (firing === 0) return <span className="sr-only">Alerts</span>;
  return (
    <>
      <span className="sr-only">Alerts, {firing} firing</span>
      <span
        aria-hidden="true"
        data-testid="alerts-badge"
        className="absolute top-1 right-0.5 min-w-5 rounded-full bg-bad-solid px-1 text-center text-xs leading-5 font-semibold text-white"
      >
        {firing > 99 ? "99+" : firing}
      </span>
    </>
  );
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="bell"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** A crash in the badge shows the plain bell, never an error in the header. */
class BadgeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[Alerts badge] failed to render", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
