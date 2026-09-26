import { lazy, Suspense, useId } from "react";
import type { HistoryItems } from "@satisfactory-dash/shared";
import { formatPerMinute, formatTime, unitLabel } from "../format";
import { labelFor, type ItemLabel } from "./itemLabels";
import { itemStats, RANGE_WORDS, toItemChartData } from "./itemHistory";

// uPlot is only needed once a chart shows: a separate chunk, as on the Power page. React.lazy caches
// a failed import for good, so on failure swap in a fresh lazy component and a retry imports again.
const loadChart = () =>
  import("./ItemChart").then(
    (m) => ({ default: m.ItemChart }),
    (error: unknown) => {
      ItemChart = lazy(loadChart);
      throw error;
    },
  );
let ItemChart = lazy(loadChart);

/** Holds the chart's place while its chunk loads, so nothing jumps. Hidden like the chart itself. */
function ChartPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-chart-loading=""
      className="grid h-[279px] place-items-center rounded-md bg-surface-2 text-sm text-muted motion-safe:animate-pulse sm:h-[250px]"
    >
      Loading chart…
    </div>
  );
}

const iso = (t: number) => new Date(t).toISOString();

/**
 * One item's stored production over the chosen range (ADR-0027 decision 3): an item picker, a text
 * summary, the chart (the bucket average against capacity, a gap where nothing was recorded) and
 * a readings table. `item` undefined picks the first series, the highest rate.
 */
export function ItemHistoryPanel({
  history,
  labels,
  item,
  onItem,
}: {
  history: HistoryItems;
  labels: Map<string, ItemLabel>;
  item: string | undefined;
  onItem: (item: string) => void;
}) {
  const pickerId = useId();
  if (history.series.length === 0) {
    return <p>No production history recorded in this range yet.</p>;
  }
  const series = history.series.find((s) => s.item === item) ?? history.series[0];
  const label = labelFor(labels, series.item);
  const stats = itemStats(series.points);
  return (
    <div className="grid gap-3">
      <label htmlFor={pickerId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        Item
        <select id={pickerId} value={series.item} onChange={(e) => onItem(e.target.value)}>
          {history.series.map((s) => (
            <option key={s.item} value={s.item}>
              {labelFor(labels, s.item).name}
            </option>
          ))}
        </select>
      </label>
      {history.truncated && <p className="text-sm text-muted">Showing the 50 items made fastest in this range.</p>}
      {stats && (
        <p>
          {label.name}, {RANGE_WORDS[history.range].toLowerCase()}: average {formatPerMinute(stats.average, label.unit)}, low{" "}
          {formatPerMinute(stats.low, label.unit)}, high {formatPerMinute(stats.high, label.unit)}; capacity{" "}
          {formatPerMinute(stats.capacity, label.unit)}.
        </p>
      )}
      {/* The contract allows a series with no points: an item with nothing recorded in this range. */}
      {series.points.length === 0 ? (
        <p className="text-sm text-muted">No readings for {label.name} in this range yet.</p>
      ) : series.points.length < 2 ? (
        <p className="text-sm text-muted">Only one reading in this range so far.</p>
      ) : (
        <>
          <Suspense fallback={<ChartPlaceholder />}>
            {/* key: a new item gets a new chart, with its own unit on the axis. */}
            <ItemChart key={series.item} data={toItemChartData(series.points, history.resolutionSeconds)} unitLabel={unitLabel(label.unit)} />
          </Suspense>
          <p className="text-sm text-muted">A break in the line means nothing was recorded then (the game was paused or the server couldn't be reached).</p>
        </>
      )}
      {series.points.length > 0 && <ReadingsTable points={series.points} label={label} />}
    </div>
  );
}

/** The chart's data as text, collapsed: every bucket's average and capacity. */
function ReadingsTable({ points, label }: { points: HistoryItems["series"][number]["points"]; label: ItemLabel }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted">Readings table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line [contain:inline-size]">
        <table className="readings">
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Produced (avg)</th>
              <th scope="col">Capacity</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t}>
                <th scope="row">
                  <time dateTime={iso(p.t)}>{formatTime(iso(p.t))}</time>
                </th>
                <td>{formatPerMinute(p.currentPerMinute.avg, label.unit)}</td>
                <td>{formatPerMinute(p.maxPerMinute, label.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
