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
}: {
  overall: { health: Shown; headline: string };
  sections: OverviewSection[];
}) {
  const allClear = overall.health === "ok";
  return (
    <section aria-labelledby="overview-heading" className="grid gap-4">
      <h2 id="overview-heading" className="sr-only">
        Overview
      </h2>
      <p
        role="status"
        className={cn("flex items-center gap-3 rounded-card px-5 py-4 text-lg font-semibold sm:text-xl", BANNER[overall.health])}
      >
        <span aria-hidden="true" className="grid size-7 flex-none place-items-center rounded-full bg-white/20 text-base">
          {allClear ? "✓" : overall.health === "pending" ? "…" : "!"}
        </span>
        {overall.headline}
      </p>
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
