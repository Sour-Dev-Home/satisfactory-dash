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
