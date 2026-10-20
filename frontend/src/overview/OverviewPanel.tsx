import { useEffect, useRef } from "react";
import type { ServerPlayersResponse } from "@satisfactory-dash/shared";
import { CardGrid } from "./cards/CardGrid";
import { HealthCard, type Age, type Tick } from "./cards/HealthCard";
import { PlayersCard, type PlayersState } from "./cards/PlayersCard";
import type { PowerState } from "./cards/power";
import { PowerCard } from "./cards/PowerCard";
import type { OverviewSection } from "./cards/StationTiles";
import type { Shown } from "./cards/words";

export type { OverviewSection };

/**
 * The Overview (ADR-0041, #442): the Health card says the overall state once and holds Server, Power
 * and Factory as station tiles; Players beside it; then the grid's power as a flowing circuit.
 */
export function OverviewPanel({
  overall,
  sections,
  players,
  tick,
  age,
  power,
  roster,
  bannerHidden = false,
  onDismiss,
}: {
  overall: { health: Shown; headline: string };
  sections: OverviewSection[];
  players: PlayersState;
  /** The server tick for the Health card; left out while the status loads or fails. */
  tick?: Tick;
  /** The status snapshot's age, beside the tick. */
  age?: Age;
  /** The grid's totals for the Power card; left out, the card isn't shown. */
  power?: PowerState;
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
        <HealthCard
          overall={overall}
          tick={tick}
          age={age}
          sections={sections}
          hidden={bannerHidden}
          onDismiss={dismiss}
          headingRef={healthHeading}
        />
        <PlayersCard state={players} roster={roster} />
      </CardGrid>
      {power !== undefined && <PowerCard state={power} />}
    </section>
  );
}
