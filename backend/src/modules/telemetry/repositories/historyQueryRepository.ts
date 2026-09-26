import { z } from "zod";
import { parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0027 decision 3, the READ side: the rollups (written by historyRepository.ts) re-bucketed at query time to the
 * resolution the range needs. Every SQL text is a constant; values only travel as parameters (the bucket length goes
 * through make_interval, never into the text). A server is addressed by its public id and a removed one matches
 * nothing. Buckets are aligned to UTC: date_bin's origin is the Unix epoch.
 *
 * Averages are weighted by `samples`, the minimum is the minimum of the minimums and the maximum the maximum of the
 * maximums, exactly as the hourly rollup itself is built from the minute rollup.
 */

/** Source rollups: resolution 60 (1-minute) or 3600 (hourly). */
export type RollupResolution = 60 | 3600;

const PowerRowSchema = z.object({
  session: z.number().int(),
  circuit: z.number().int(),
  t: z.number(),
  samples: z.number().int(),
  production_min: z.number(),
  production_avg: z.number(),
  production_max: z.number(),
  consumption_min: z.number(),
  consumption_avg: z.number(),
  consumption_max: z.number(),
  capacity_avg: z.number(),
  battery_min: z.number(),
  battery_avg: z.number(),
  battery_max: z.number(),
  fuse_samples: z.number().int(),
});
export type PowerBucketRow = z.infer<typeof PowerRowSchema>;

const ItemRankSchema = z.object({ item: z.string() });
const ItemRowSchema = z.object({
  item: z.string(),
  t: z.number(),
  samples: z.number().int(),
  current_min: z.number(),
  current_avg: z.number(),
  current_max: z.number(),
  max_avg: z.number(),
});
export type ItemBucketRow = z.infer<typeof ItemRowSchema>;

const TransitionRowSchema = z.object({
  t: z.number(),
  building_id: z.string(),
  class_name: z.string(),
  from_state: z.string().nullable(),
  to_state: z.string(),
});
export type TransitionEventRow = z.infer<typeof TransitionRowSchema>;

// $1 server public id, $2 bucket seconds, $3 source resolution, $4 from, $5 to
const POWER_BUCKETS = `
  SELECT r.session::int AS session, r.circuit::int AS circuit,
         (extract(epoch FROM date_bin(make_interval(secs => $2::double precision), r.bucket, 'epoch'::timestamptz)) * 1000)::float8 AS t,
         sum(r.samples)::int AS samples,
         min(r.production_min)::float8 AS production_min,
         (sum(r.production_avg * r.samples) / sum(r.samples))::float8 AS production_avg,
         max(r.production_max)::float8 AS production_max,
         min(r.consumption_min)::float8 AS consumption_min,
         (sum(r.consumption_avg * r.samples) / sum(r.samples))::float8 AS consumption_avg,
         max(r.consumption_max)::float8 AS consumption_max,
         (sum(r.capacity_avg * r.samples) / sum(r.samples))::float8 AS capacity_avg,
         min(r.battery_min)::float8 AS battery_min,
         (sum(r.battery_avg * r.samples) / sum(r.samples))::float8 AS battery_avg,
         max(r.battery_max)::float8 AS battery_max,
         sum(r.fuse_samples)::int AS fuse_samples
  FROM telemetry.power_rollups r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
    AND r.resolution = $3::smallint AND r.bucket >= $4::timestamptz AND r.bucket < $5::timestamptz
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3`;

// $1 server public id, $2 source resolution, $3 from, $4 to, $5 how many to return
const TOP_ITEMS = `
  SELECT r.item AS item
  FROM telemetry.item_rollups r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
    AND r.resolution = $2::smallint AND r.bucket >= $3::timestamptz AND r.bucket < $4::timestamptz
  GROUP BY r.item
  ORDER BY sum(r.current_avg * r.samples) / sum(r.samples) DESC, r.item
  LIMIT $5::int`;

// $1 server public id, $2 bucket seconds, $3 source resolution, $4 from, $5 to, $6 the items
const ITEM_BUCKETS = `
  SELECT r.item AS item,
         (extract(epoch FROM date_bin(make_interval(secs => $2::double precision), r.bucket, 'epoch'::timestamptz)) * 1000)::float8 AS t,
         sum(r.samples)::int AS samples,
         min(r.current_min)::float8 AS current_min,
         (sum(r.current_avg * r.samples) / sum(r.samples))::float8 AS current_avg,
         max(r.current_max)::float8 AS current_max,
         (sum(r.max_avg * r.samples) / sum(r.samples))::float8 AS max_avg
  FROM telemetry.item_rollups r
  JOIN servers.servers s ON s.id = r.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
    AND r.resolution = $3::smallint AND r.bucket >= $4::timestamptz AND r.bucket < $5::timestamptz
    AND r.item = ANY($6::text[])
  GROUP BY 1, 2
  ORDER BY 1, 2`;

// $1 server public id, $2 from, $3 to, $4 how many rows
const TRANSITIONS = `
  SELECT (extract(epoch FROM t.at) * 1000)::float8 AS t, t.building_id AS building_id, t.class_name AS class_name,
         t.from_state AS from_state, t.to_state AS to_state
  FROM telemetry.building_transitions t
  JOIN servers.servers s ON s.id = t.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND t.at >= $2::timestamptz AND t.at < $3::timestamptz
  ORDER BY t.at DESC, t.id DESC
  LIMIT $4::int`;

const iso = (ms: number): string => new Date(ms).toISOString();

export async function queryPowerBuckets(
  db: Queryable,
  input: { serverPublicId: string; bucketSeconds: number; source: RollupResolution; fromMs: number; toMs: number },
): Promise<PowerBucketRow[]> {
  const result = await db.query(POWER_BUCKETS, [input.serverPublicId, input.bucketSeconds, input.source, iso(input.fromMs), iso(input.toMs)]);
  return parseRows(PowerRowSchema, result.rows, "telemetry.history.power");
}

/** The items with the highest average rate in the window, best first: asks for `limit`, so a caller passing cap + 1
 *  learns whether the cap cut anything off. */
export async function queryTopItems(
  db: Queryable,
  input: { serverPublicId: string; source: RollupResolution; fromMs: number; toMs: number; limit: number },
): Promise<string[]> {
  const result = await db.query(TOP_ITEMS, [input.serverPublicId, input.source, iso(input.fromMs), iso(input.toMs), input.limit]);
  return parseRows(ItemRankSchema, result.rows, "telemetry.history.topItems").map((row) => row.item);
}

export async function queryItemBuckets(
  db: Queryable,
  input: {
    serverPublicId: string;
    bucketSeconds: number;
    source: RollupResolution;
    fromMs: number;
    toMs: number;
    items: string[];
  },
): Promise<ItemBucketRow[]> {
  if (input.items.length === 0) return [];
  const result = await db.query(ITEM_BUCKETS, [
    input.serverPublicId,
    input.bucketSeconds,
    input.source,
    iso(input.fromMs),
    iso(input.toMs),
    input.items,
  ]);
  return parseRows(ItemRowSchema, result.rows, "telemetry.history.items");
}

/** Newest first. Pass the limit you want plus one to learn whether there were more. */
export async function queryTransitions(
  db: Queryable,
  input: { serverPublicId: string; fromMs: number; toMs: number; limit: number },
): Promise<TransitionEventRow[]> {
  const result = await db.query(TRANSITIONS, [input.serverPublicId, iso(input.fromMs), iso(input.toMs), input.limit]);
  return parseRows(TransitionRowSchema, result.rows, "telemetry.history.transitions");
}
