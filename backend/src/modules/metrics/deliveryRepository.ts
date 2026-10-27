import { z } from "zod";
import { DeliverySnapshotSchema } from "@satisfactory-dash/shared";
import type { DeliverySnapshot } from "@satisfactory-dash/shared";
import { parseFirst } from "../../platform/db/rows.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";

/**
 * ADR-0056 section 4 (PR 6b): `metrics.delivery_snapshots`, one row per pushed delivery snapshot. The ingest keeps the
 * newest `DELIVERY_SNAPSHOTS_KEPT` rows, pruned on insert; the page reads the newest one.
 */
export const DELIVERY_SNAPSHOTS_KEPT = 90;

/** The schema version the page reads; a row of another version (an older or newer script) is not shown. */
const CURRENT_SCHEMA_VERSION = 2;

const INSERT_SNAPSHOT = `
  INSERT INTO metrics.delivery_snapshots (generated_at, schema_version, body)
  VALUES ($1::timestamptz, $2::int, $3::jsonb)`;

// Newest by id (the identity is monotonic), so two snapshots with the same received_at still have one order.
const PRUNE_SNAPSHOTS = `
  DELETE FROM metrics.delivery_snapshots
  WHERE id < (SELECT min(id) FROM (SELECT id FROM metrics.delivery_snapshots ORDER BY id DESC LIMIT $1::int) AS kept)`;

const LATEST_SNAPSHOT = `
  SELECT body FROM metrics.delivery_snapshots
  WHERE schema_version = $1::int
  ORDER BY id DESC
  LIMIT 1`;

const LatestRowSchema = z.object({ body: z.unknown() });

/** Stores one validated snapshot, then prunes to the newest `DELIVERY_SNAPSHOTS_KEPT`. */
export async function insertDeliverySnapshot(db: Queryable, snapshot: DeliverySnapshot): Promise<void> {
  await timedQuery(db, "metrics.insertDeliverySnapshot", INSERT_SNAPSHOT, [snapshot.generatedAt, snapshot.schemaVersion, JSON.stringify(snapshot)]);
  await timedQuery(db, "metrics.pruneDeliverySnapshots", PRUNE_SNAPSHOTS, [DELIVERY_SNAPSHOTS_KEPT]);
}

/** The newest stored snapshot, or `undefined` when none is stored (or the newest no longer parses under the contract). */
export async function latestDeliverySnapshot(db: Queryable): Promise<DeliverySnapshot | undefined> {
  const { rows } = await timedQuery(db, "metrics.latestDeliverySnapshot", LATEST_SNAPSHOT, [CURRENT_SCHEMA_VERSION]);
  const row = parseFirst(LatestRowSchema, rows, "metrics.latestDeliverySnapshot");
  if (row === undefined) return undefined;
  const parsed = DeliverySnapshotSchema.safeParse(row.body);
  return parsed.success ? parsed.data : undefined;
}
