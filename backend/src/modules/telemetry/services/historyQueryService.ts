import type {
  HistoryItems,
  HistoryPower,
  HistoryRange,
  HistoryTransitions,
  TransitionRange,
} from "@satisfactory-dash/shared";
import { withTransaction } from "../../../platform/db/transaction.js";
import { RowShapeError } from "../../../platform/db/rows.js";
import { ServiceUnavailableError } from "../../../platform/errorResponse.js";
import {
  queryItemBuckets,
  queryPowerBuckets,
  queryTopItems,
  queryTransitions,
  type RollupResolution,
} from "../repositories/historyQueryRepository.js";

/** What the service needs from the database: a pool (a transaction carries the cost guard). Taken from
 *  withTransaction, so this file never imports the pg driver itself (ADR-0025 decision 2, sqlGuard.test.ts). */
export type HistoryDb = Parameters<typeof withTransaction>[0];

const SECOND = 1000;
const RANGE_SECONDS: Record<HistoryRange, number> = {
  "1h": 3600,
  "6h": 21_600,
  "24h": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  "1y": 31_536_000,
};
/** The bucket lengths the API can answer with, finest first. */
const BUCKETS = [60, 300, 900, 3600, 21_600, 86_400] as const;
/** The API aims at no more points than this per series. */
export const MAX_POINTS = 600;
/** A bucket of this length or more is read from the hourly rollups; anything finer from the 1-minute ones. */
const HOURLY_FROM_SECONDS = 3600;
/** "All items" returns at most this many, the ones with the highest average rate. */
export const MAX_ITEMS = 50;
/** Per-query cost guard: a query that runs longer is cancelled and the request is a 503. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;

export interface Resolution {
  /** Bucket length, seconds. */
  bucketSeconds: number;
  /** Which rollups are read: 60 = 1-minute, 3600 = hourly. */
  source: RollupResolution;
}

/**
 * The range picks the resolution: the smallest bucket that keeps the range at or under MAX_POINTS points, read
 * from the 1-minute rollups only while the bucket is under an hour (re-bucketing 30 days of minute rows at query
 * time would touch millions of rows per request; the hourly rollups have 720 a series).
 */
export function chooseResolution(range: HistoryRange): Resolution {
  const seconds = RANGE_SECONDS[range];
  const bucketSeconds = BUCKETS.find((bucket) => seconds / bucket <= MAX_POINTS) ?? BUCKETS[BUCKETS.length - 1];
  return { bucketSeconds, source: bucketSeconds >= HOURLY_FROM_SECONDS ? 3600 : 60 };
}

export interface HistoryQueryOptions {
  now?: () => number;
  statementTimeoutMs?: number;
}

/**
 * ADR-0027: history for ONE server (by its public id), read from the rollups. Every read runs in a read
 * transaction with a statement timeout: a slow query is cancelled and becomes a 503, never a hang. A failed
 * database is a 503 as well (the cause is kept for the log).
 */
export class HistoryQueryService {
  private readonly now: () => number;
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly db: HistoryDb,
    private readonly serverPublicId: string,
    options: HistoryQueryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  async power(range: HistoryRange): Promise<HistoryPower> {
    const window = this.window(range);
    const rows = await this.read((client) =>
      queryPowerBuckets(client, { serverPublicId: this.serverPublicId, bucketSeconds: window.bucketSeconds, source: window.source, fromMs: window.fromMs, toMs: window.toMs }),
    );
    // One series per (session, circuit): a circuit id from another game session is not the same circuit (ADR-0006).
    const bySeries = new Map<string, HistoryPower["series"][number]>();
    for (const row of rows) {
      const key = `${row.session}:${row.circuit}`;
      let series = bySeries.get(key);
      if (series === undefined) {
        series = { session: row.session, circuit: row.circuit, points: [] };
        bySeries.set(key, series);
      }
      series.points.push({
        t: row.t,
        samples: row.samples,
        productionMW: { min: row.production_min, avg: row.production_avg, max: row.production_max },
        consumptionMW: { min: row.consumption_min, avg: row.consumption_avg, max: row.consumption_max },
        capacityMW: row.capacity_avg,
        batteryPercent: { min: row.battery_min, avg: row.battery_avg, max: row.battery_max },
        fuseTrippedSamples: row.fuse_samples,
      });
    }
    // Newest data first; the session hash says nothing about age, so order by the last point.
    const series = [...bySeries.values()].sort(
      (a, b) => (b.points[b.points.length - 1]?.t ?? 0) - (a.points[a.points.length - 1]?.t ?? 0),
    );
    return { range, resolutionSeconds: window.bucketSeconds, from: window.fromMs, to: window.toMs, series };
  }

  async items(range: HistoryRange, item?: string): Promise<HistoryItems> {
    const window = this.window(range);
    const { truncated, rows } = await this.read(async (client) => {
      let items: string[];
      let cut = false;
      if (item !== undefined) {
        items = [item];
      } else {
        const ranked = await queryTopItems(client, {
          serverPublicId: this.serverPublicId,
          source: window.source,
          fromMs: window.fromMs,
          toMs: window.toMs,
          limit: MAX_ITEMS + 1,
        });
        cut = ranked.length > MAX_ITEMS;
        items = ranked.slice(0, MAX_ITEMS);
      }
      const buckets = await queryItemBuckets(client, {
        serverPublicId: this.serverPublicId,
        bucketSeconds: window.bucketSeconds,
        source: window.source,
        fromMs: window.fromMs,
        toMs: window.toMs,
        items,
      });
      return { truncated: cut, rows: { items, buckets } };
    });
    const byItem = new Map<string, HistoryItems["series"][number]>(rows.items.map((name) => [name, { item: name, points: [] }]));
    for (const row of rows.buckets) {
      byItem.get(row.item)?.points.push({
        t: row.t,
        samples: row.samples,
        currentPerMinute: { min: row.current_min, avg: row.current_avg, max: row.current_max },
        maxPerMinute: row.max_avg,
      });
    }
    // Highest average rate first (the ranking order), and an item with no data in the window is left out.
    const series = rows.items.flatMap((name) => {
      const found = byItem.get(name);
      return found !== undefined && found.points.length > 0 ? [found] : [];
    });
    return { range, resolutionSeconds: window.bucketSeconds, from: window.fromMs, to: window.toMs, truncated, series };
  }

  async transitions(range: TransitionRange, limit: number): Promise<HistoryTransitions> {
    const toMs = this.now();
    const fromMs = toMs - RANGE_SECONDS[range] * SECOND;
    const rows = await this.read((client) =>
      queryTransitions(client, { serverPublicId: this.serverPublicId, fromMs, toMs, limit: limit + 1 }),
    );
    return {
      range,
      from: fromMs,
      to: toMs,
      truncated: rows.length > limit,
      transitions: rows.slice(0, limit).map((row) => ({
        t: row.t,
        buildingId: row.building_id,
        className: row.class_name,
        fromState: row.from_state,
        toState: row.to_state,
      })),
    };
  }

  /** The window: `from` is aligned DOWN to a bucket boundary (UTC), so the first bucket is a whole one. */
  private window(range: HistoryRange) {
    const { bucketSeconds, source } = chooseResolution(range);
    const toMs = this.now();
    const bucketMs = bucketSeconds * SECOND;
    const fromMs = Math.floor((toMs - RANGE_SECONDS[range] * SECOND) / bucketMs) * bucketMs;
    return { bucketSeconds, source, fromMs, toMs };
  }

  private async read<T>(fn: (client: Parameters<Parameters<typeof withTransaction>[1]>[0]) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, async (client) => {
        // set_config(..., true) is SET LOCAL: it ends with the transaction. Bound, so nothing is interpolated.
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(this.statementTimeoutMs)]);
        return fn(client);
      });
    } catch (err) {
      if (err instanceof RowShapeError) {
        throw err; // a bug in our own SQL or schema: a 500, not an outage
      }
      throw Object.assign(new ServiceUnavailableError(), { cause: err });
    }
  }
}
