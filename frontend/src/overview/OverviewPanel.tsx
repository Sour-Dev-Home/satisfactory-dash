import { Link } from "react-router";
import { cn } from "../lib/cn";
import type { Health, SectionState } from "./health";

export interface OverviewSection {
  name: string;
  /** The section's own page, when it has one. */
  to?: string;
  state: SectionState;
}

type Shown = Health | "pending";

const BANNER: Record<Shown, string> = {
  ok: "bg-ok-solid text-white",
  paused: "bg-info-solid text-white",
  degraded: "bg-warn-solid text-white",
  unavailable: "bg-idle-solid text-white",
  outage: "bg-bad-solid text-white",
  pending: "bg-surface-2 text-fg-strong",
};

const WORD: Record<Shown, string> = {
  ok: "Operational",
  paused: "Paused",
  degraded: "Degraded",
  unavailable: "Unavailable",
  outage: "Outage",
  pending: "Checking…",
};

const WORD_COLOR: Record<Shown, string> = {
  ok: "text-ok",
  paused: "text-info",
  degraded: "text-warn",
  unavailable: "text-muted",
  outage: "text-bad",
  pending: "text-muted",
};

function shown(state: SectionState): { health: Shown; summary: string } {
  if (state === "pending") return { health: "pending", summary: "Loading…" };
  if (state === "error") return { health: "unavailable", summary: "Couldn't load this section" };
  return state;
}

/** Direction B2: one banner for "is everything OK?", then one row per section. */
export function OverviewPanel({
  overall,
  sections,
  bannerHidden = false,
  onDismiss,
}: {
  overall: { health: Shown; headline: string };
  sections: OverviewSection[];
  /** The operator dismissed this banner (a warning only; see canDismiss). */
  bannerHidden?: boolean;
  /** Shows the × when given: "hide until something changes". */
  onDismiss?: () => void;
}) {
  const allClear = overall.health === "ok";
  return (
    <section aria-labelledby="overview-heading" className="grid gap-4">
      {/* tabIndex -1: the shell moves focus here after navigation (Shell.tsx). */}
      <h2 id="overview-heading" tabIndex={-1} className="sr-only">
        Overview
      </h2>
      {/* A slim bar (the owner's call): one line, the colour carries the level. */}
      {!bannerHidden && (
        <div className={cn("flex items-center gap-3 rounded-card py-1 pr-1 pl-4 font-semibold", BANNER[overall.health])}>
          <span aria-hidden="true" className="grid size-5 flex-none place-items-center rounded-full bg-white/20 text-xs">
            {allClear ? "✓" : overall.health === "pending" ? "…" : "!"}
          </span>
          <p role="status" className="min-h-11 flex-1 content-center">
            {overall.headline}
          </p>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Hide this warning until something changes"
              title="Hide until something changes"
              className="grid min-w-11 flex-none place-items-center border-0 bg-transparent px-0 text-lg text-inherit hover:bg-white/15"
            >
              ×
            </button>
          )}
        </div>
      )}
      <ul aria-label="Sections" className="divide-y divide-line rounded-card border border-line bg-surface">
        {sections.map((section) => {
          const { health, summary } = shown(section.state);
          const body = (
            <>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold text-fg-strong">{section.name}</span>
                <span className="text-sm text-muted">{summary}</span>
              </span>
              <span className={cn("ml-auto flex flex-none items-center gap-2 text-sm font-medium", WORD_COLOR[health])}>
                <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                {WORD[health]}
              </span>
            </>
          );
          const row = "flex min-h-11 items-center gap-4 px-5 py-4";
          return (
            <li key={section.name}>
              {section.to ? (
                <Link to={section.to} className={cn(row, "text-inherit no-underline hover:bg-surface-2")}>
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
