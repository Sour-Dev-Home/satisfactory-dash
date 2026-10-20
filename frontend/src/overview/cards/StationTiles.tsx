import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { StationIcon, type StationKind } from "../../ui/StationIcon";
import type { SectionState } from "../health";
import { wordColor, wordFor, type Shown } from "./words";

export interface OverviewSection {
  name: string;
  /** The station icon its tile shows. */
  station: StationKind;
  /** The section's own page, when it has one. */
  to?: string;
  state: SectionState;
}

function shown(state: SectionState): { health: Shown; summary: string } {
  if (state === "pending") return { health: "pending", summary: "Loading…" };
  if (state === "error") return { health: "unavailable", summary: "Couldn't load this section" };
  return state;
}

/** factoryHealth's "N machines · 2 backed up": the count, when it isn't 0, is worth the warn colour. */
const BACKED_UP = /^(.* · )([1-9]\d* backed up)$/;

/**
 * The tile's one-line detail. A healthy factory with machines backed up shows that count in the
 * warn colour (#442), so it stands out without making the whole area a warning.
 */
function Detail({ health, summary }: { health: Shown; summary: string }) {
  const match = health === "ok" ? BACKED_UP.exec(summary) : null;
  if (!match) return <span className="text-sm text-muted">{summary}</span>;
  return (
    <span className="text-sm text-muted">
      {match[1]}
      <span className="text-warn">{match[2]}</span>
    </span>
  );
}

/**
 * Server, Power and Factory as station tiles (#442), inside the Health card. The card says the overall
 * state once, so a tile is silent while its area is healthy and shows its status word only when it
 * isn't (or is still loading): a problem stands out. Each tile links to its page when it has one.
 */
export function StationTiles({ sections }: { sections: OverviewSection[] }) {
  if (sections.length === 0) return null;
  return (
    // Three across where the card is wide; stacked on a phone and in the narrow rail between md and lg.
    <ul aria-label="Sections" className="grid gap-2 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
      {sections.map((section) => {
        const { health, summary } = shown(section.state);
        const body = (
          <>
            <StationIcon kind={section.station} size={28} />
            <span className="grid min-w-0 gap-0.5">
              <span className="font-display font-semibold tracking-wide text-fg-strong uppercase">{section.name}</span>
              {health !== "ok" && (
                <span data-word="" className={cn("flex items-center gap-1.5 text-sm font-medium", wordColor(health))}>
                  <span aria-hidden="true" className="size-2 flex-none rounded-full bg-current" />
                  {wordFor(health)}
                </span>
              )}
              <Detail health={health} summary={summary} />
            </span>
          </>
        );
        // On the canvas, not surface-2: the bad red is under AA on surface-2 (ADR-0041 item 1).
        const tile = "flex h-full min-h-touch items-start gap-3 rounded-md border border-line bg-canvas p-3";
        return (
          <li key={section.name}>
            {section.to ? (
              <Link to={section.to} className={cn(tile, "text-inherit no-underline hover:border-muted")}>
                {body}
              </Link>
            ) : (
              <div className={tile}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
