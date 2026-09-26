import { Component, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { cn } from "../lib/cn";
import { useSelectedServer } from "../servers/ServerContext";
import { AlertsMenu } from "./AlertsMenu";

/**
 * The header's bell (the owner's call: a bell, not a sixth tab, so the five tabs still fit at
 * 390 px). It opens the alerts dropdown, a non-modal disclosure like the account menu (ADR-0016
 * item 8): Escape closes it and returns focus to the bell, and so does a click outside or tabbing
 * out of it. The badge counts the selected server's firing alerts. It's decoration on every page,
 * so it never gets in the way: while loading, on any error or with nothing firing it shows no
 * badge, and a crash hides only the badge.
 */
export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="flex"
      // Tabbing past the last item (focus leaving the bell and its dropdown) closes it.
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !root.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative inline-flex size-11 flex-none items-center justify-center rounded-md border-0 p-0 focus-visible:-outline-offset-2",
          open ? "bg-surface-2 text-fg-strong" : "bg-transparent text-muted hover:text-fg-strong",
        )}
      >
        <BellIcon />
        <BadgeBoundary fallback={<span className="sr-only">Alerts</span>}>
          <FiringBadge />
        </BadgeBoundary>
      </button>
      {open && (
        <div
          id={panelId}
          // Inside the viewport at any width: positioned against the header row (not the bell, which
          // has the account button to its right), so right-aligned with the page edge just below the
          // header, never wider than the screen minus the page gutters, and scrolling when long.
          className="absolute top-full right-0 z-(--z-popover) mt-2 max-h-(--popover-max-height) w-(--popover-width) overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-lg"
        >
          <AlertsMenu onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** The accessible name and the visible count, from the status the dropdown also reads. */
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
