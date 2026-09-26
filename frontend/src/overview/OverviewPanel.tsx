import { useEffect, useRef } from "react";
import type { ServerPlayersResponse } from "@satisfactory-dash/shared";
import { Link } from "react-router";
import { cn } from "../lib/cn";
import { CardGrid } from "./cards/CardGrid";
import { HealthCard, type Tick } from "./cards/HealthCard";
import { WORD, WORD_COLOR, type Shown } from "./cards/words";
import { PlayersCard, type PlayersState } from "./cards/PlayersCard";
import type { SectionState } from "./health";

export interface OverviewSection {
  name: string;
  /** The section's own page, when it has one. */
  to?: string;
  state: SectionState;
}

function shown(state: SectionState): { health: Shown; summary: string } {
  if (state === "pending") return { health: "pending", summary: "Loading…" };
  if (state === "error") return { health: "unavailable", summary: "Couldn't load this section" };
  return state;
}

/** Direction B2: the cards (Health first: "is everything OK?"), then one row per section. */
export function OverviewPanel({
  overall,
  sections,
  players,
  tick,
  roster,
  bannerHidden = false,
  onDismiss,
}: {
  overall: { health: Shown; headline: string };
  sections: OverviewSection[];
  players: PlayersState;
  /** The server tick for the Health card; left out while the status loads or fails. */
  tick?: Tick;
  /** Who is online, when the server can say (ADR-0029). */
  roster?: ServerPlayersResponse;
  /** The operator hid this warning (a warning only; see canDismiss). */
  bannerHidden?: boolean;
  /** Shows the Hide button when given: "hide until something changes". */
  onDismiss?: () => void;
}) {
  // The Hide button disappears once clicked, which would drop keyboard focus to <body>: move
  // it to the Health card's own heading instead. The flag holds for the one commit after the
  // click (no dependency list): if that render doesn't hide the warning, it's dropped, so a later
  // unrelated hide never steals focus.
  const healthHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterDismiss = useRef(false);
  useEffect(() => {
    if (bannerHidden && focusAfterDismiss.current) healthHeading.current?.focus();
    focusAfterDismiss.current = false;
  });
  const dismiss = onDismiss
    ? () => {
        focusAfterDismiss.current = true;
        onDismiss();
      }
    : undefined;

  return (
    <section aria-labelledby="overview-heading" className="grid gap-4">
      {/* tabIndex -1: the shell moves focus here after navigation (Shell.tsx). */}
      <h2 id="overview-heading" tabIndex={-1} className="sr-only">
        Overview
      </h2>
      <CardGrid>
        <HealthCard overall={overall} tick={tick} hidden={bannerHidden} onDismiss={dismiss} headingRef={healthHeading} />
        <PlayersCard state={players} roster={roster} />
      </CardGrid>
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
          const row = "flex min-h-touch items-center gap-4 px-5 py-4";
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
