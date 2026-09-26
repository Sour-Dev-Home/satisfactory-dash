import type { HistoryPower } from "@satisfactory-dash/shared";
import { formatMW, formatTime } from "../format";
import { ChartSlot, RangeRow } from "./PowerHistoryPanel";
import { currentSession, fuseStretches, RANGE_WORDS, storedStats, toStoredChartData } from "./storedHistory";

const iso = (t: number) => new Date(t).toISOString();

/** Bucket length in words, e.g. "5-minute" or "1-day" averages. */
function bucketWords(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}-day`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}-hour`;
  return `${Math.round(seconds / 60)}-minute`;
}

/**
 * Stored power history (ADR-0027) for one range, one chart per circuit of the newest game session.
 * The backend already averaged the samples into buckets; this only draws them. Like the live chart,
 * the canvas is hidden from screen readers: the summary, the fuse note and the table carry the data.
 */
export function StoredPowerHistoryPanel({ history }: { history: HistoryPower }) {
  const { shown, olderSessions } = currentSession(history.series);
  return (
    <section aria-labelledby="power-history-heading" className="panel">
      <h3 id="power-history-heading">{RANGE_WORDS[history.range]}</h3>
      <p className="text-sm text-muted">
        {bucketWords(history.resolutionSeconds)} averages. A break in a line means nothing was recorded then (the game
        was paused or the server couldn't be reached).
      </p>
      {shown.length === 0 ? (
        <p>No power history recorded in this range yet.</p>
      ) : (
        shown.map((series) => {
          const stats = storedStats(series.points);
          return (
            <article key={series.circuit} aria-label={`Circuit ${series.circuit} history`} className="grid gap-3">
              <h4>Circuit {series.circuit}</h4>
              {stats && (
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                  <RangeRow label="Production" range={{ current: stats.production.latest, ...stats.production }} />
                  <RangeRow label="Consumption" range={{ current: stats.consumption.latest, ...stats.consumption }} />
                </dl>
              )}
              {series.points.length < 2 ? (
                <p className="text-sm text-muted">Only one reading in this range so far.</p>
              ) : (
                <ChartSlot data={toStoredChartData(series.points, history.resolutionSeconds)} pausedRanges={[]} />
              )}
              {fuseStretches(series.points, history.resolutionSeconds).map((s) => (
                <p key={s.fromT} className="text-sm text-bad">
                  Fuse tripped between <time dateTime={iso(s.fromT)}>{formatTime(iso(s.fromT))}</time> and{" "}
                  <time dateTime={iso(s.toT)}>{formatTime(iso(s.toT))}</time>.
                </p>
              ))}
              <details>
                <summary className="cursor-pointer text-sm text-muted">Readings table</summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line [contain:inline-size]">
                  <table className="readings">
                    <thead>
                      <tr>
                        <th scope="col">From</th>
                        <th scope="col">Production (avg)</th>
                        <th scope="col">Consumption (avg)</th>
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
                          <td>{formatMW(p.productionMW.avg)}</td>
                          <td>{formatMW(p.consumptionMW.avg)}</td>
                          <td>{formatMW(p.capacityMW)}</td>
                          <td>{p.fuseTrippedSamples > 0 ? "Tripped" : "OK"}</td>
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
      {olderSessions > 0 && (
        <p className="text-sm text-muted">
          {olderSessions === 1 ? "An earlier game session" : `${olderSessions} earlier game sessions`} in this range{" "}
          {olderSessions === 1 ? "isn't" : "aren't"} shown: circuit numbers change between sessions.
        </p>
      )}
    </section>
  );
}
