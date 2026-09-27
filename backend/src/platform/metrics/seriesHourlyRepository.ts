import { z } from "zod";
import { parseOne } from "../db/rows.js";
import type { Queryable } from "../db/schemaVersion.js";
import type { SeriesDelta } from "./aggregator.js";

// SQL constants are plain templates without interpolation (the SQL guard rejects "+" and ${}).
const UPSERT_DELTA = `
  INSERT INTO metrics.series_hourly (hour, metric, labels, count, sum, bucket_counts)
  VALUES (to_timestamp($1 / 1000.0), $2, $3::jsonb, $4, $5, $6::integer[])
  ON CONFLICT (hour, metric, labels) DO UPDATE SET
    count = metrics.series_hourly.count + excluded.count,
    sum = metrics.series_hourly.sum + excluded.sum,
    bucket_counts = metrics.merge_bucket_counts(metrics.series_hourly.bucket_counts, excluded.bucket_counts)`;

/** Adds one delta's count/sum/bucket_counts into its (hour, metric, labels) row, creating it if
 *  needed. Safe to call for the same delta more than once only if the caller means to add it more
 *  than once (this is the DB-side "add", not idempotent by itself) — `seriesFlushWorker.ts` is what
 *  makes a flush idempotent, by draining each delta out of the in-process aggregator exactly once. */
export async function addSeriesDelta(db: Queryable, delta: SeriesDelta): Promise<void> {
  await db.query(UPSERT_DELTA, [
    delta.hourStartMs,
    delta.metric,
    JSON.stringify(delta.labels),
    delta.count,
    delta.sum,
    // The pg driver serializes a JS array into Postgres's own array-literal syntax ("{1,2,3}"), never
    // JSON's "[1,2,3]" (which ::integer[] rejects as malformed): pass the array as-is, not JSON.stringify'd.
    delta.bucketCounts ?? null,
  ]);
}

export async function addSeriesDeltas(db: Queryable, deltas: readonly SeriesDelta[]): Promise<void> {
  for (const delta of deltas) {
    await addSeriesDelta(db, delta);
  }
}

const MERGE_BUCKET_COUNTS = `SELECT metrics.merge_bucket_counts($1::integer[], $2::integer[]) AS merged`;

/** Calls the migration's SQL merge function directly, so its element-wise math can be tested
 *  against a real Postgres without going through a full upsert (ADR-0037 PR 2 test: "bucket merge
 *  math"). Either side may be null, matching a fresh row's first flush. */
export async function mergeBucketCountsInDb(db: Queryable, a: number[] | null, b: number[] | null): Promise<number[] | null> {
  const result = await db.query(MERGE_BUCKET_COUNTS, [a, b]);
  return parseOne(z.object({ merged: z.array(z.coerce.number().int()).nullable() }), result.rows, "metrics.mergeBucketCountsInDb").merged;
}

const RETENTION_DAYS = 90;
/** One purge call deletes at most this many rows (batched, like the history retention job), so a
 *  large backlog (e.g. after the worker was down a while) never holds one long-running DELETE. */
const PURGE_BATCH_SIZE = 5_000;

// Wrapped in a CTE so it returns one row with the deleted count (the Queryable exposes rows only).
const PURGE_EXPIRED = `
  WITH d AS (
    DELETE FROM metrics.series_hourly
    WHERE ctid IN (SELECT ctid FROM metrics.series_hourly WHERE hour < $1::timestamptz LIMIT $2)
    RETURNING 1)
  SELECT count(*)::int AS deleted FROM d`;

/** Deletes rows older than the retention window (in batches) and returns how many. `nowMs` is injectable for tests. */
export async function purgeExpiredSeries(db: Queryable, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    const result = await db.query(PURGE_EXPIRED, [cutoff, PURGE_BATCH_SIZE]);
    const deleted = parseOne(z.object({ deleted: z.coerce.number().int().min(0) }), result.rows, "metrics.purgeExpiredSeries").deleted;
    total += deleted;
    if (deleted < PURGE_BATCH_SIZE) break;
  }
  return total;
}
