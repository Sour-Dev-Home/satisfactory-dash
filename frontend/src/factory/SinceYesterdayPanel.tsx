import type { HistoryItems, HistoryTransitions } from "@satisfactory-dash/shared";
import { formatAmount, formatPerMinute } from "../format";
import { labelFor, type ItemLabel } from "./itemLabels";
import { sinceYesterday, transitionCount, type ItemChange } from "./sinceYesterday";

const hourOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "−70%", "+30%", or "new" when there was nothing yesterday. */
function change(c: ItemChange): string {
  if (c.ratio === null) return "new";
  const pct = Math.round(c.ratio * 100);
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/** One plain line: "Screw: 40 → 12 items/min (−70%)". The arrow glyph beside it is decoration. */
function line(c: ItemChange, label: ItemLabel): string {
  return `${label.name}: ${formatAmount(c.before)} → ${formatPerMinute(c.after, label.unit)} (${change(c)})`;
}

function Changes({ title, changes, labels, down }: { title: string; changes: ItemChange[]; labels: Map<string, ItemLabel>; down: boolean }) {
  if (changes.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-fg-strong">{title}</h4>
      <ul aria-label={title} className="grid gap-0.5">
        {changes.map((c) => (
          <li key={c.item}>
            <span aria-hidden="true" className={down ? "mr-1.5 text-warn" : "mr-1.5 text-ok"}>
              {down ? "▼" : "▲"}
            </span>
            {line(c, labelFor(labels, c.item))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ADR-0027 item 6: what changed since this hour yesterday, in text first. The headline is the
 * biggest drop; then short lists of notable drops and rises, and how often machines changed state.
 * `history` is the 7d range (hourly buckets); `transitions` the last 24 h, or undefined while it
 * loads or if it failed (the comparison still shows).
 */
export function SinceYesterdayPanel({
  history,
  transitions,
  labels,
}: {
  history: HistoryItems;
  transitions?: HistoryTransitions;
  labels: Map<string, ItemLabel>;
}) {
  const result = sinceYesterday(history);
  const drop = result.enough ? result.down[0] : undefined;
  return (
    <section aria-labelledby="since-yesterday-heading" className="panel">
      <h3 id="since-yesterday-heading">
        Since yesterday
        {result.enough && (
          <>
            {/* The space outside the span: a name computation trims a span's leading space. */}{" "}
            <span className="font-normal text-muted">
              · this hour yesterday (<time dateTime={new Date(result.hour).toISOString()}>{hourOf(result.hour)}</time>)
            </span>
          </>
        )}
      </h3>
      {!result.enough ? (
        <p className="text-muted">Not enough history yet: this compares with the same hour yesterday.</p>
      ) : result.down.length === 0 && result.up.length === 0 ? (
        <p>No big changes since this hour yesterday.</p>
      ) : (
        <>
          {drop ? (
            <p className="font-semibold text-fg-strong">Biggest drop: {line(drop, labelFor(labels, drop.item))}</p>
          ) : (
            <p className="font-semibold text-fg-strong">Nothing dropped much since this hour yesterday.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Changes title="Down" changes={result.down} labels={labels} down />
            <Changes title="Up" changes={result.up} labels={labels} down={false} />
          </div>
        </>
      )}
      {transitions && (
        <p className="text-sm text-muted">
          Machines changed state {transitionCount(transitions)} {transitions.transitions.length === 1 && !transitions.truncated ? "time" : "times"} in the last 24 h.
        </p>
      )}
    </section>
  );
}
