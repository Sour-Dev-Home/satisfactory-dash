import { Link } from "react-router";
import { BOTTLENECKS_LINK, bottleneckCountText } from "./plannerText";

/** A bottleneck count that links to the Factory page's Bottlenecks section; "No bottlenecks" is plain text. */
export function BottleneckBadge({ count, what }: { count: number; what: string }) {
  if (count === 0) return <span className="text-muted">{bottleneckCountText(0)}</span>;
  return (
    <Link to={BOTTLENECKS_LINK} aria-label={`${bottleneckCountText(count)} in ${what}, on the Factory page`} className="font-semibold text-warn">
      {bottleneckCountText(count)}
    </Link>
  );
}

/**
 * A card's bottleneck line. The bottlenecks read is not one the page's reveal waits for, so it can answer after the cards
 * are on screen: the line stands a line tall from the first render and fills in place, instead of appearing and pushing
 * every card, the notes and the footer below it down (the Planner's page-reveal layout shift on a phone). With no count
 * (not answered yet, or failed) it stays empty rather than guessed.
 */
export function BottleneckLine({ count, what }: { count: number | undefined; what: string }) {
  return (
    <p data-bottleneck-line="" className="m-0 min-h-lh text-sm">
      {count !== undefined && <BottleneckBadge count={count} what={what} />}
    </p>
  );
}
