import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0027 decision 3: production history in the `telemetry` schema, hand-written SQL (ADR-0025 decision 2).
 * Downsampling is by AGGREGATION: raw samples (5 s power, 30 s items) are kept 48 hours, rolled up into 1-minute
 * buckets (kept 30 days) and 1-hour buckets (kept 1 year) by an idempotent job. Transitions are events kept 30 days.
 *
 * Servers are addressed by their PUBLIC id (what the pollers know); a server that is not registered (or was removed)
 * simply matches no row, so a write for it inserts nothing. Every SQL text is a constant: values only travel as
 * parameters, arrays are unpacked with unnest(), and there is no dynamic table name.
 */

export const RAW_RETENTION_MS = 48 * 60 * 60 * 1000;
export const MINUTE_ROLLUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const HOUR_ROLLUP_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const TRANSITION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Rows per INSERT statement: bounds parameter arrays (one statement per chunk). */
const INSERT_CHUNK = 5_000;

export interface PowerSampleRow {
  /** 32-bit hash of the game session's name: a series never spans a session change. */
  session: number;
  circuit: number;
  atMs: number;
  productionMW: number;
  consumptionMW: number;
  capacityMW: number;
  batteryPercent: number;
  fuseTripped: boolean;
}

export interface ItemSampleRow {
  item: string;
  atMs: number;
  currentPerMinute: number;
  maxPerMinute: number;
}

export interface TransitionRow {
  atMs: number;
  buildingId: string;
  className: string;
  fromState: string | null;
  toState: string;
}

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

function* chunks<T>(rows: T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    yield rows.slice(i, i + INSERT_CHUNK);
  }
}

const INSERT_POWER_SAMPLES = `
  INSERT INTO telemetry.power_samples
    (server_id, session, circuit, at, production_mw, consumption_mw, capacity_mw, battery_pct, fuse_tripped)
  SELECT s.id, x.session, x.circuit, to_timestamp(x.at_ms / 1000.0), x.production, x.consumption, x.capacity, x.battery, x.fuse
  FROM servers.servers s,
       unnest($2::int[], $3::int[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::bool[])
         AS x(session, circuit, at_ms, production, consumption, capacity, battery, fuse)
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT DO NOTHING`;

/** Writes power samples for one server. A sample with a non-finite number is dropped (never stored as NaN). */
export async function insertPowerSamples(db: Queryable, serverPublicId: string, rows: PowerSampleRow[]): Promise<void> {
  const valid = rows.filter((row) =>
    [row.session, row.circuit, row.atMs, row.productionMW, row.consumptionMW, row.capacityMW, row.batteryPercent].every(isFiniteNumber),
  );
  for (const chunk of chunks(valid)) {
    await db.query(INSERT_POWER_SAMPLES, [
      serverPublicId,
      chunk.map((row) => row.session),
      chunk.map((row) => row.circuit),
      chunk.map((row) => row.atMs),
      chunk.map((row) => row.productionMW),
      chunk.map((row) => row.consumptionMW),
      chunk.map((row) => row.capacityMW),
      chunk.map((row) => row.batteryPercent),
      chunk.map((row) => row.fuseTripped),
    ]);
  }
}

const INSERT_ITEM_SAMPLES = `
  INSERT INTO telemetry.item_samples (server_id, item, at, current_per_min, max_per_min)
  SELECT s.id, x.item, to_timestamp(x.at_ms / 1000.0), x.current, x.maximum
  FROM servers.servers s,
       unnest($2::text[], $3::float8[], $4::float8[], $5::float8[]) AS x(item, at_ms, current, maximum)
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT DO NOTHING`;

/** Writes factory-wide per-item rates for one server. Non-finite or negative rates, and items with an odd name, are dropped. */
export async function insertItemSamples(db: Queryable, serverPublicId: string, rows: ItemSampleRow[]): Promise<void> {
  const valid = rows.filter(
    (row) =>
      row.item.length > 0 &&
      row.item.length <= 200 &&
      isFiniteNumber(row.atMs) &&
      isFiniteNumber(row.currentPerMinute) &&
      isFiniteNumber(row.maxPerMinute) &&
      row.currentPerMinute >= 0 &&
      row.maxPerMinute >= 0,
  );
  for (const chunk of chunks(valid)) {
    await db.query(INSERT_ITEM_SAMPLES, [
      serverPublicId,
      chunk.map((row) => row.item),
      chunk.map((row) => row.atMs),
      chunk.map((row) => row.currentPerMinute),
      chunk.map((row) => row.maxPerMinute),
    ]);
  }
}

const INSERT_TRANSITIONS = `
  INSERT INTO telemetry.building_transitions (server_id, at, building_id, class_name, from_state, to_state)
  SELECT s.id, to_timestamp(x.at_ms / 1000.0), x.building_id, x.class_name, x.from_state, x.to_state
  FROM servers.servers s,
       unnest($2::float8[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS x(at_ms, building_id, class_name, from_state, to_state)
  WHERE s.public_id = $1 AND s.deleted_at IS NULL`;

/** Writes machine-state transitions (events) for one server. */
export async function insertTransitions(db: Queryable, serverPublicId: string, rows: TransitionRow[]): Promise<void> {
  const valid = rows.filter(
    (row) =>
      isFiniteNumber(row.atMs) &&
      row.buildingId.length > 0 &&
      row.buildingId.length <= 200 &&
      row.className.length > 0 &&
      row.className.length <= 200 &&
      row.toState.length > 0 &&
      row.toState.length <= 40 &&
      (row.fromState === null || (row.fromState.length > 0 && row.fromState.length <= 40)),
  );
  for (const chunk of chunks(valid)) {
    await db.query(INSERT_TRANSITIONS, [
      serverPublicId,
      chunk.map((row) => row.atMs),
      chunk.map((row) => row.buildingId),
      chunk.map((row) => row.className),
      chunk.map((row) => row.fromState),
      chunk.map((row) => row.toState),
    ]);
  }
}

// --- rollups: idempotent, safe to run any number of times over any window ------------------------------------------------

const ROLLUP_POWER_MINUTES = `
  INSERT INTO telemetry.power_rollups
    (server_id, session, circuit, resolution, bucket, samples,
     production_min, production_avg, production_max, consumption_min, consumption_avg, consumption_max,
     capacity_avg, battery_min, battery_avg, battery_max, fuse_samples)
  SELECT server_id, session, circuit, 60, date_trunc('minute', at, 'UTC'), count(*)::int,
         min(production_mw), avg(production_mw), max(production_mw),
         min(consumption_mw), avg(consumption_mw), max(consumption_mw),
         avg(capacity_mw), min(battery_pct), avg(battery_pct), max(battery_pct),
         (count(*) FILTER (WHERE fuse_tripped))::int
  FROM telemetry.power_samples
  WHERE at >= $1::timestamptz AND at < $2::timestamptz
  GROUP BY server_id, session, circuit, date_trunc('minute', at, 'UTC')
  ON CONFLICT (server_id, session, circuit, resolution, bucket) DO UPDATE SET
    samples = EXCLUDED.samples,
    production_min = EXCLUDED.production_min, production_avg = EXCLUDED.production_avg, production_max = EXCLUDED.production_max,
    consumption_min = EXCLUDED.consumption_min, consumption_avg = EXCLUDED.consumption_avg, consumption_max = EXCLUDED.consumption_max,
    capacity_avg = EXCLUDED.capacity_avg,
    battery_min = EXCLUDED.battery_min, battery_avg = EXCLUDED.battery_avg, battery_max = EXCLUDED.battery_max,
    fuse_samples = EXCLUDED.fuse_samples`;

const ROLLUP_ITEM_MINUTES = `
  INSERT INTO telemetry.item_rollups
    (server_id, item, resolution, bucket, samples, current_min, current_avg, current_max, max_avg)
  SELECT server_id, item, 60, date_trunc('minute', at, 'UTC'), count(*)::int,
         min(current_per_min), avg(current_per_min), max(current_per_min), avg(max_per_min)
  FROM telemetry.item_samples
  WHERE at >= $1::timestamptz AND at < $2::timestamptz
  GROUP BY server_id, item, date_trunc('minute', at, 'UTC')
  ON CONFLICT (server_id, item, resolution, bucket) DO UPDATE SET
    samples = EXCLUDED.samples, current_min = EXCLUDED.current_min, current_avg = EXCLUDED.current_avg,
    current_max = EXCLUDED.current_max, max_avg = EXCLUDED.max_avg`;

// The hourly rows are built from the minute rows: averages are weighted by the samples behind each minute.
const ROLLUP_POWER_HOURS = `
  INSERT INTO telemetry.power_rollups
    (server_id, session, circuit, resolution, bucket, samples,
     production_min, production_avg, production_max, consumption_min, consumption_avg, consumption_max,
     capacity_avg, battery_min, battery_avg, battery_max, fuse_samples)
  SELECT server_id, session, circuit, 3600, date_trunc('hour', bucket, 'UTC'), sum(samples)::int,
         min(production_min), sum(production_avg * samples) / sum(samples), max(production_max),
         min(consumption_min), sum(consumption_avg * samples) / sum(samples), max(consumption_max),
         sum(capacity_avg * samples) / sum(samples), min(battery_min), sum(battery_avg * samples) / sum(samples), max(battery_max),
         sum(fuse_samples)::int
  FROM telemetry.power_rollups
  WHERE resolution = 60 AND bucket >= $1::timestamptz AND bucket < $2::timestamptz
  GROUP BY server_id, session, circuit, date_trunc('hour', bucket, 'UTC')
  ON CONFLICT (server_id, session, circuit, resolution, bucket) DO UPDATE SET
    samples = EXCLUDED.samples,
    production_min = EXCLUDED.production_min, production_avg = EXCLUDED.production_avg, production_max = EXCLUDED.production_max,
    consumption_min = EXCLUDED.consumption_min, consumption_avg = EXCLUDED.consumption_avg, consumption_max = EXCLUDED.consumption_max,
    capacity_avg = EXCLUDED.capacity_avg,
    battery_min = EXCLUDED.battery_min, battery_avg = EXCLUDED.battery_avg, battery_max = EXCLUDED.battery_max,
    fuse_samples = EXCLUDED.fuse_samples`;

const ROLLUP_ITEM_HOURS = `
  INSERT INTO telemetry.item_rollups
    (server_id, item, resolution, bucket, samples, current_min, current_avg, current_max, max_avg)
  SELECT server_id, item, 3600, date_trunc('hour', bucket, 'UTC'), sum(samples)::int,
         min(current_min), sum(current_avg * samples) / sum(samples), max(current_max), sum(max_avg * samples) / sum(samples)
  FROM telemetry.item_rollups
  WHERE resolution = 60 AND bucket >= $1::timestamptz AND bucket < $2::timestamptz
  GROUP BY server_id, item, date_trunc('hour', bucket, 'UTC')
  ON CONFLICT (server_id, item, resolution, bucket) DO UPDATE SET
    samples = EXCLUDED.samples, current_min = EXCLUDED.current_min, current_avg = EXCLUDED.current_avg,
    current_max = EXCLUDED.current_max, max_avg = EXCLUDED.max_avg`;

const floorTo = (ms: number, unit: number): number => Math.floor(ms / unit) * unit;

/**
 * Rolls raw samples into 1-minute buckets, then 1-minute buckets into 1-hour buckets, for the window
 * [`fromMs`, `toMs`). Only WHOLE minutes are rolled (the minute in progress is left for the next run) and the hourly
 * pass covers every hour the window touches, so an hour is recomputed until its last minute is in. Idempotent: running
 * it again over the same window rewrites the same numbers, so a crash or an overlap costs nothing.
 */
export async function rollUp(db: Queryable, window: { fromMs: number; toMs: number }): Promise<void> {
  const from = floorTo(window.fromMs, MINUTE_MS);
  const to = floorTo(window.toMs, MINUTE_MS);
  if (!(to > from)) return;
  const bounds = [new Date(from).toISOString(), new Date(to).toISOString()];
  await db.query(ROLLUP_POWER_MINUTES, bounds);
  await db.query(ROLLUP_ITEM_MINUTES, bounds);
  const hourBounds = [new Date(floorTo(from, HOUR_MS)).toISOString(), new Date(to).toISOString()];
  await db.query(ROLLUP_POWER_HOURS, hourBounds);
  await db.query(ROLLUP_ITEM_HOURS, hourBounds);
}

// --- retention: batched deletes ----------------------------------------------------------------------------------------

const PURGE_POWER_SAMPLES = `
  DELETE FROM telemetry.power_samples
  WHERE ctid IN (SELECT ctid FROM telemetry.power_samples WHERE at < $1::timestamptz LIMIT $2)`;
const PURGE_ITEM_SAMPLES = `
  DELETE FROM telemetry.item_samples
  WHERE ctid IN (SELECT ctid FROM telemetry.item_samples WHERE at < $1::timestamptz LIMIT $2)`;
const PURGE_POWER_MINUTES = `
  DELETE FROM telemetry.power_rollups
  WHERE ctid IN (SELECT ctid FROM telemetry.power_rollups WHERE resolution = 60 AND bucket < $1::timestamptz LIMIT $2)`;
const PURGE_POWER_HOURS = `
  DELETE FROM telemetry.power_rollups
  WHERE ctid IN (SELECT ctid FROM telemetry.power_rollups WHERE resolution = 3600 AND bucket < $1::timestamptz LIMIT $2)`;
const PURGE_ITEM_MINUTES = `
  DELETE FROM telemetry.item_rollups
  WHERE ctid IN (SELECT ctid FROM telemetry.item_rollups WHERE resolution = 60 AND bucket < $1::timestamptz LIMIT $2)`;
const PURGE_ITEM_HOURS = `
  DELETE FROM telemetry.item_rollups
  WHERE ctid IN (SELECT ctid FROM telemetry.item_rollups WHERE resolution = 3600 AND bucket < $1::timestamptz LIMIT $2)`;
const PURGE_TRANSITIONS = `
  DELETE FROM telemetry.building_transitions
  WHERE ctid IN (SELECT ctid FROM telemetry.building_transitions WHERE at < $1::timestamptz LIMIT $2)`;

export interface PurgeCounts {
  powerSamples: number;
  itemSamples: number;
  powerMinutes: number;
  powerHours: number;
  itemMinutes: number;
  itemHours: number;
  transitions: number;
}

export interface PurgeOptions {
  /** Rows per DELETE. */
  batchSize?: number;
  /** A safety cap on DELETEs per table per run, so one run cannot go on forever; the next run continues. */
  maxBatches?: number;
}

const DEFAULT_BATCH = 5_000;
const DEFAULT_MAX_BATCHES = 200;

async function deleteInBatches(db: Queryable, sql: string, cutoff: string, options: Required<PurgeOptions>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < options.maxBatches; batch++) {
    const result = await db.query(sql, [cutoff, options.batchSize]);
    const deleted = parseFirst(z.object({ deleted: z.number().int() }), result.rows, "telemetry.purge")?.deleted;
    // A DELETE without RETURNING has no rows; the row count is not on the Queryable, so count through RETURNING below.
    total += deleted ?? 0;
    if ((deleted ?? 0) < options.batchSize) break;
  }
  return total;
}

/**
 * Deletes what is past its retention, in batches (ADR-0027 decision 3): raw samples 48 h, 1-minute rollups 30 d, hourly
 * rollups 1 y, transitions 30 d. Returns how many rows went from each table.
 */
export async function purgeExpired(db: Queryable, nowMs: number, options: PurgeOptions = {}): Promise<PurgeCounts> {
  const resolved: Required<PurgeOptions> = {
    batchSize: options.batchSize ?? DEFAULT_BATCH,
    maxBatches: options.maxBatches ?? DEFAULT_MAX_BATCHES,
  };
  const cutoff = (retentionMs: number) => new Date(nowMs - retentionMs).toISOString();
  return {
    powerSamples: await deleteInBatches(db, PURGE_POWER_SAMPLES, cutoff(RAW_RETENTION_MS), resolved),
    itemSamples: await deleteInBatches(db, PURGE_ITEM_SAMPLES, cutoff(RAW_RETENTION_MS), resolved),
    powerMinutes: await deleteInBatches(db, PURGE_POWER_MINUTES, cutoff(MINUTE_ROLLUP_RETENTION_MS), resolved),
    powerHours: await deleteInBatches(db, PURGE_POWER_HOURS, cutoff(HOUR_ROLLUP_RETENTION_MS), resolved),
    itemMinutes: await deleteInBatches(db, PURGE_ITEM_MINUTES, cutoff(MINUTE_ROLLUP_RETENTION_MS), resolved),
    itemHours: await deleteInBatches(db, PURGE_ITEM_HOURS, cutoff(HOUR_ROLLUP_RETENTION_MS), resolved),
    transitions: await deleteInBatches(db, PURGE_TRANSITIONS, cutoff(TRANSITION_RETENTION_MS), resolved),
  };
}
