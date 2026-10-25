import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";

/**
 * ADR-0052 PR 2: `telemetry.latest_snapshots`, ONE row per server holding the last status, power and factory an agent
 * sent (never players: names are not written to the database). Overwritten in place, no history. Servers are addressed
 * by their public id; a server that is removed matches no live row, so neither a load nor an upsert touches it.
 */

/** The upsert is a cache write: a row is only replaced by one that is not older (ADR-0054 D3.5: a second backend
 *  instance, or the old task's last flush, can never put older data over newer), and only for a live server (ADR-0052
 *  2.7: the final flush after a removal cannot bring the row back). */
const UPSERT = `
  INSERT INTO telemetry.latest_snapshots (
    server_id, reachable, unreachable_since, last_received_at,
    status, status_observed_at, power, power_observed_at, factory, factory_observed_at,
    auto_pause, auto_pause_pending, auto_pause_observed_at, updated_at
  )
  SELECT s.id, $2::boolean, $3::timestamptz, $4::timestamptz,
         $5::jsonb, $6::timestamptz, $7::jsonb, $8::timestamptz, $9::jsonb, $10::timestamptz,
         $11::boolean, $12::boolean, $13::timestamptz, now()
  FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT (server_id) DO UPDATE SET
    reachable = excluded.reachable,
    unreachable_since = excluded.unreachable_since,
    last_received_at = excluded.last_received_at,
    status = excluded.status,
    status_observed_at = excluded.status_observed_at,
    power = excluded.power,
    power_observed_at = excluded.power_observed_at,
    factory = excluded.factory,
    factory_observed_at = excluded.factory_observed_at,
    auto_pause = excluded.auto_pause,
    auto_pause_pending = excluded.auto_pause_pending,
    auto_pause_observed_at = excluded.auto_pause_observed_at,
    updated_at = now()
  WHERE telemetry.latest_snapshots.last_received_at <= excluded.last_received_at`;

const LOAD = `
  SELECT l.reachable, l.unreachable_since, l.last_received_at,
         l.status, l.status_observed_at, l.power, l.power_observed_at, l.factory, l.factory_observed_at,
         l.auto_pause, l.auto_pause_pending, l.auto_pause_observed_at
  FROM telemetry.latest_snapshots l
  JOIN servers.servers s ON s.id = l.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL`;

/** What is written. The three parts arrive already serialized (the writer measures the factory against its cap). */
export interface LatestSnapshotWrite {
  reachable: boolean;
  unreachableSinceMs: number | undefined;
  lastReceivedAtMs: number;
  statusJson: string | null;
  statusObservedAtMs: number | undefined;
  powerJson: string | null;
  powerObservedAtMs: number | undefined;
  factoryJson: string | null;
  factoryObservedAtMs: number | undefined;
  autoPause: { autoPause: boolean; pending: boolean; observedAtMs: number } | undefined;
}

/** What is read back: parts are raw JSON for the store to validate; times are epoch ms. */
export interface LatestSnapshotRow {
  reachable: boolean;
  unreachableSinceMs: number | undefined;
  lastReceivedAtMs: number;
  status: { data: unknown; observedAtMs: number } | undefined;
  power: { data: unknown; observedAtMs: number } | undefined;
  factory: { data: unknown; observedAtMs: number } | undefined;
  autoPause: { autoPause: boolean; pending: boolean; observedAtMs: number } | undefined;
}

export interface LatestSnapshotRepository {
  load(serverPublicId: string): Promise<LatestSnapshotRow | undefined>;
  upsert(serverPublicId: string, write: LatestSnapshotWrite): Promise<void>;
}

const RowSchema = z.object({
  reachable: z.boolean(),
  unreachable_since: z.date().nullable(),
  last_received_at: z.date(),
  status: z.unknown().nullable(),
  status_observed_at: z.date().nullable(),
  power: z.unknown().nullable(),
  power_observed_at: z.date().nullable(),
  factory: z.unknown().nullable(),
  factory_observed_at: z.date().nullable(),
  auto_pause: z.boolean().nullable(),
  auto_pause_pending: z.boolean().nullable(),
  auto_pause_observed_at: z.date().nullable(),
});

const iso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString());

function part(data: unknown, at: Date | null): { data: unknown; observedAtMs: number } | undefined {
  return data === null || data === undefined || at === null ? undefined : { data, observedAtMs: at.getTime() };
}

export function createLatestSnapshotRepository(db: Queryable): LatestSnapshotRepository {
  return {
    async load(serverPublicId) {
      const result = await timedQuery(db, "telemetry.latestSnapshots.load", LOAD, [serverPublicId]);
      const row = parseFirst(RowSchema, result.rows, "telemetry.latest_snapshots");
      if (row === undefined) return undefined;
      return {
        reachable: row.reachable,
        unreachableSinceMs: row.unreachable_since?.getTime(),
        lastReceivedAtMs: row.last_received_at.getTime(),
        status: part(row.status, row.status_observed_at),
        power: part(row.power, row.power_observed_at),
        factory: part(row.factory, row.factory_observed_at),
        autoPause:
          row.auto_pause === null || row.auto_pause_observed_at === null
            ? undefined
            : { autoPause: row.auto_pause, pending: row.auto_pause_pending === true, observedAtMs: row.auto_pause_observed_at.getTime() },
      };
    },
    async upsert(serverPublicId, w) {
      await timedQuery(db, "telemetry.latestSnapshots.upsert", UPSERT, [
        serverPublicId,
        w.reachable,
        iso(w.unreachableSinceMs),
        new Date(w.lastReceivedAtMs).toISOString(),
        w.statusJson,
        iso(w.statusObservedAtMs),
        w.powerJson,
        iso(w.powerObservedAtMs),
        w.factoryJson,
        iso(w.factoryObservedAtMs),
        w.autoPause?.autoPause ?? null,
        w.autoPause === undefined ? null : w.autoPause.pending,
        iso(w.autoPause?.observedAtMs),
      ]);
    },
  };
}
