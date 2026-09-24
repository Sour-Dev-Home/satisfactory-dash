import type { Ref } from "react";
import type { Status } from "@satisfactory-dash/shared";
import { MAX_FIGURES, playersText } from "./players";
import { StickFigure } from "./StickFigure";

export type PlayersState = { status: Status } | "pending" | "error";

/**
 * The Players card (the cards brief, item 1): a figure per player slot, filled when someone
 * is connected, and the count as text. No game running is a neutral state, never an alarm.
 * Room below the count for a short name list (ADR-0029, later).
 */
export function PlayersCard({ state, headingRef }: { state: PlayersState; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    // Spans the row while it's the only card under Health (half a row next to nothing read as
    // unfinished); cards PR 3 puts the tick-rate card beside it and drops md:col-span-2.
    <section
      aria-labelledby="players-heading"
      className="grid content-start gap-3 rounded-card border border-line bg-surface p-5 md:col-span-2"
    >
      {/* tabIndex -1: focus lands here after the Health card is dismissed (OverviewPanel). */}
      <h3 id="players-heading" ref={headingRef} tabIndex={-1} className="mb-0">
        Players
      </h3>
      <PlayersBody state={state} />
    </section>
  );
}

function PlayersBody({ state }: { state: PlayersState }) {
  if (state === "pending") return <p className="text-muted">Loading…</p>;
  if (state === "error") return <p className="text-muted">Couldn't load the player count.</p>;
  const { status } = state;
  if (!status.isGameRunning) return <p className="text-muted">No game running.</p>;
  if (status.playerLimit === 0) return <p className="text-muted">The server allows no players.</p>;

  const slots = Math.min(status.playerLimit, MAX_FIGURES);
  const filled = Math.min(status.connectedPlayers, slots);
  const more = status.playerLimit - slots;
  return (
    <>
      <div className="flex flex-wrap items-end gap-1.5">
        {Array.from({ length: slots }, (_, i) => (
          <StickFigure key={i} filled={i < filled} className={i < filled ? "text-fg-strong" : "text-muted"} />
        ))}
        {more > 0 && (
          <span aria-hidden="true" className="ml-1 text-sm text-muted">
            +{more}
          </span>
        )}
      </div>
      <p className="font-semibold text-fg-strong">{playersText(status)}</p>
      {/* Paused is the server's auto-pause (or a player's), not a fault: say it plainly. */}
      {status.gamePaused && <p className="text-sm text-muted">The game is paused.</p>}
    </>
  );
}
