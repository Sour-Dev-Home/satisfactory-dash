import type { ServerPlayersResponse, Status } from "@satisfactory-dash/shared";
import { cn } from "../../lib/cn";
import { MAX_FIGURES, MAX_NAMES, playersText } from "./players";
import { StickFigure } from "./StickFigure";

export type PlayersState = { status: Status } | "pending" | "error";

/**
 * The Players card (the cards brief, item 1): a figure per player slot, filled when someone
 * is connected, and the count as text. No game running is a neutral state, never an alarm.
 * With FicsitRemoteMonitoring, also who is online (ADR-0029: names only, live, never stored);
 * without it (`available: false`), or while that list loads or fails, just the counts.
 */
export function PlayersCard({ state, roster }: { state: PlayersState; roster?: ServerPlayersResponse }) {
  return (
    <section aria-labelledby="players-heading" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      {/* The same 44 px header row as Health's (which holds the Hide button). */}
      <h3 id="players-heading" className="mb-0 flex min-h-[44px] items-center">
        Players
      </h3>
      <PlayersBody state={state} roster={roster} />
    </section>
  );
}

/** The online players' names, as text (they come from the game server: never HTML). */
function OnlineNames({ roster }: { roster: ServerPlayersResponse }) {
  const online = roster.players.filter((p) => p.online).map((p) => p.name);
  if (online.length === 0) return null;
  const shown = online.slice(0, MAX_NAMES);
  return (
    <div className="text-sm text-muted">
      <ul aria-label="Players online" className="flex flex-wrap gap-x-3 gap-y-1">
        {shown.map((name, i) => (
          // Names aren't unique ids (two players can share one): the index keeps keys unique.
          <li key={`${i}-${name}`} className="text-fg">
            {name}
          </li>
        ))}
      </ul>
      {online.length > shown.length && <p>and {online.length - shown.length} more</p>}
    </div>
  );
}

function PlayersBody({ state, roster }: { state: PlayersState; roster?: ServerPlayersResponse }) {
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
      {/* From lg up the card is as tall as the Health square beside it: bigger figures, centred in
          whatever height the text leaves, so a quiet server doesn't leave a gap at the bottom. */}
      <div className="flex items-end gap-1.5 lg:flex-1 lg:items-center">
        {/* Twelve figures don't fit one row on a phone, or in the narrow column beside Health
            between md and lg: two even rows of six there, not 10 + 2. */}
        <div className="grid grid-cols-6 gap-1.5 sm:flex sm:flex-wrap sm:items-end md:grid lg:flex lg:gap-2.5">
          {Array.from({ length: slots }, (_, i) => (
            <StickFigure
              key={i}
              filled={i < filled}
              className={cn("lg:h-15 lg:w-10", i < filled ? "text-fg-strong" : "text-muted")}
            />
          ))}
        </div>
        {more > 0 && (
          <span aria-hidden="true" className="ml-1 text-sm text-muted">
            +{more}
          </span>
        )}
      </div>
      <p className="font-semibold text-fg-strong">{playersText(status)}</p>
      {roster?.available && <OnlineNames roster={roster} />}
      {/* Paused is the server's auto-pause (or a player's), not a fault: say it plainly. */}
      {status.gamePaused && <p className="text-sm text-muted">The game is paused.</p>}
    </>
  );
}
