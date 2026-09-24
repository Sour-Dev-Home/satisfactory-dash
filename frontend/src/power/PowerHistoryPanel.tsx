import { lazy, Suspense } from "react";
import type { PowerHistory } from "@satisfactory-dash/shared";
import { formatMW, formatTime } from "../format";
import { fuseTrips, seriesStats, toChartData, type LivePart, type Range } from "./history";

// uPlot is about 50 kB and only this page needs it, so it's a separate chunk, loaded when the
// first chart renders (same origin, so script-src 'self' allows it). The summary and table
// don't wait for it.
// React.lazy caches a failed import for good, so the section's Try again could never
// recover: on failure, swap in a fresh lazy component, and the retry imports again.
// Whether a browser refetches a module that failed to load is [NEEDS VERIFICATION]; after a
// deploy removes the old chunk only a page reload helps.
const loadChart = () =>
  import("./PowerChart").then(
    (m) => ({ default: m.PowerChart }),
    (error: unknown) => {
      PowerChart = lazy(loadChart);
      throw error;
    },
  );
let PowerChart = lazy(loadChart);

/**
 * Holds the chart's place (plot plus legend) while its chunk loads, so nothing jumps. The
 * label says "loading" even with motion off, so it never reads as an empty chart. Hidden from
 * screen readers like the chart itself: they get the summary and table, already there.
 */
function ChartPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-chart-loading=""
      // Measured chart heights: 250 px, 279 px at phone width where the legend wraps.
      className="grid h-[279px] place-items-center rounded-md bg-surface-2 text-sm text-muted motion-safe:animate-pulse sm:h-[250px]"
    >
      Loading chart…
    </div>
  );
}

const iso = (t: number) => new Date(t).toISOString();

function RangeRow({ label, range }: { label: string; range: Range }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        {formatMW(range.current)}{" "}
        <span className="text-sm text-muted">
          (min {formatMW(range.min)}, max {formatMW(range.max)})
        </span>
      </dd>
    </div>
  );
}

/**
 * The live power chart (ADR-0022), one per circuit. The canvas is hidden from screen
 * readers; the summary (now, min, max over the window) and the readings table are the
 * accessible alternative, and list the paused stretches too.
 */
export function PowerHistoryPanel({ history, live }: { history: PowerHistory; live?: LivePart }) {
  const minutes = Math.round(history.windowSeconds / 60);
  return (
    <section aria-labelledby="power-history-heading" className="panel">
      <h3 id="power-history-heading">Last {minutes} minutes</h3>
      {history.series.length === 0 ? (
        <p>No readings yet. The chart fills in as the server is polled.</p>
      ) : (
        history.series.map((series) => {
          const stats = seriesStats(series.points);
          return (
            <article
              key={series.circuitGroupId}
              aria-label={`Circuit ${series.circuitGroupId} history`}
              className="grid gap-3"
            >
              <h4>Circuit {series.circuitGroupId}</h4>
              {stats && (
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                  <RangeRow label="Production" range={stats.production} />
                  <RangeRow label="Consumption" range={stats.consumption} />
                </dl>
              )}
              {/* One point draws nothing useful: right after the backend starts, the first
                  regular poll is all there is. */}
              {series.points.length < 2 ? (
                <p className="text-sm text-muted">Collecting readings. The chart starts after the next poll.</p>
              ) : (
                <Suspense fallback={<ChartPlaceholder />}>
                  <PowerChart
                    data={toChartData(series.points, history.intervalSeconds, live)}
                    pausedRanges={history.pausedRanges}
                  />
                </Suspense>
              )}
              {fuseTrips(series.points).map((trip) => (
                <p key={trip.fromT} className="text-sm text-bad">
                  Fuse tripped at <time dateTime={iso(trip.fromT)}>{formatTime(iso(trip.fromT))}</time>
                  {trip.toT === null ? (
                    ", still tripped."
                  ) : (
                    <>
                      , back at <time dateTime={iso(trip.toT)}>{formatTime(iso(trip.toT))}</time>.
                    </>
                  )}
                </p>
              ))}
              <details>
                <summary className="cursor-pointer text-sm text-muted">Readings table</summary>
                {/* Its own scroll box, both ways: a full window is 60+ rows per circuit, and
                    contain: inline-size stops the table's width from widening the page. */}
                <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line [contain:inline-size]">
                  <table className="readings">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Production</th>
                        <th scope="col">Consumption</th>
                        <th scope="col">Capacity</th>
                        <th scope="col">Fuse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.points.map((p) => (
                        <tr key={p.t}>
                          <th scope="row">
                            <time dateTime={iso(p.t)}>{formatTime(iso(p.t))}</time>
                          </th>
                          <td>{formatMW(p.productionMW)}</td>
                          <td>{formatMW(p.consumptionMW)}</td>
                          <td>{formatMW(p.capacityMW)}</td>
                          <td>{p.fuseTriggered ? "Tripped" : "OK"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </article>
          );
        })
      )}
      {history.pausedRanges.length > 0 && (
        <p className="text-sm text-muted">
          Paused (shaded):{" "}
          {history.pausedRanges.map((r, i) => (
            <span key={r.fromT}>
              {i > 0 && ", "}
              <time dateTime={iso(r.fromT)}>{formatTime(iso(r.fromT))}</time> to{" "}
              <time dateTime={iso(r.toT)}>{formatTime(iso(r.toT))}</time>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
