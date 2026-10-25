import { z } from "zod";
import { AlertQualityMonthSchema } from "@satisfactory-dash/shared";
import type { AlertQualityMonth } from "@satisfactory-dash/shared";
import { parseRows } from "../../../platform/db/rows.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0056 section 1 and Q4: alert quality, phase 1, over `alerts.alert_events` (kept 90 days, read through
 * `alert_events_at_idx`). "Flaps" are alerts that fired and resolved within 5 minutes: a labelled stand-in for false
 * alarms until ADR-0036 D4 records real reviews.
 *
 * Only `fired` and `resolved` rows are paired (`updated` and `renotify` are noise here). Within one alert
 * (server, kind, subject) the events alternate fired/resolved, so a fired row's NEXT row decides its outcome: resolved
 * gives the time to resolve, another fired (or nothing yet) means it has not resolved and counts toward neither flaps
 * nor the median. Months are UTC calendar months of the `fired` time. The result is aggregated over all servers: no
 * server id, subject or summary leaves this query.
 */
export const FLAP_MAX_SECONDS = 300;

// SQL constants are plain templates without interpolation (the SQL guard rejects "+" and ${}).
const QUALITY_BY_MONTH = `
  WITH ev AS (
    SELECT kind, transition, at,
           lead(transition) OVER w AS next_transition,
           lead(at) OVER w AS next_at
    FROM alerts.alert_events
    WHERE transition IN ('fired', 'resolved') AND at >= $1::timestamptz
    WINDOW w AS (PARTITION BY server_id, kind, subject ORDER BY at, id)
  ), fired AS (
    SELECT kind,
           to_char(at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
           CASE WHEN next_transition = 'resolved' THEN extract(epoch FROM next_at - at) END AS secs
    FROM ev
    WHERE transition = 'fired'
  )
  SELECT month, kind,
         count(*)::int AS fired,
         (count(*) FILTER (WHERE secs <= $2::float8))::int AS flaps,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS median_resolve_seconds
  FROM fired
  GROUP BY month, kind
  ORDER BY month, kind`;

const RowSchema = z.object({
  month: z.string(),
  kind: z.string(),
  fired: z.number().int(),
  flaps: z.number().int(),
  median_resolve_seconds: z.coerce.number().nullable(),
});

/** First instant (UTC) of the calendar month `monthsBack` months before the one holding `nowMs`. */
export function monthStart(nowMs: number, monthsBack: number): Date {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

/**
 * Alert quality per UTC month and rule kind, for the current and the two previous calendar months (the log keeps 90
 * days, so the oldest month may be partial). A row whose kind is not a valid kind string is dropped, never shown.
 */
export async function alertQualitySummary(db: Queryable, nowMs: number): Promise<AlertQualityMonth[]> {
  const result = await timedQuery(db, "alerts.qualityByMonth", QUALITY_BY_MONTH, [monthStart(nowMs, 2), FLAP_MAX_SECONDS]);
  const rows = parseRows(RowSchema, result.rows, "alerts.qualityByMonth");
  const out: AlertQualityMonth[] = [];
  for (const row of rows) {
    const parsed = AlertQualityMonthSchema.safeParse({
      month: row.month,
      kind: row.kind,
      fired: row.fired,
      flaps: row.flaps,
      medianResolveSeconds: row.median_resolve_seconds === null ? null : Math.round(row.median_resolve_seconds * 10) / 10,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
