import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0038 M3 (#353): `map.world_layers`, one row per (server, layer), LATEST ONLY (a new ingest
 * overwrites the row). Servers are addressed by their PUBLIC id (what the routes and the agent
 * credential know), joined to the internal uuid here, same convention as telemetry's
 * historyRepository.ts. Every SQL text is a constant; values only travel as parameters.
 */

export interface WorldLayerRow {
  hash: string;
  /** ISO. */
  observedAt: string;
  truncated: boolean;
  count: number;
  data: unknown[];
}

const WorldLayerRowSchema = z.object({
  hash: z.string(),
  observed_at: z.union([z.string(), z.date()]),
  truncated: z.boolean(),
  count: z.number().int(),
  data: z.array(z.unknown()),
});

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

const SELECT_LATEST = `
  SELECT w.hash, w.observed_at, w.truncated, w.count, w.data
  FROM map.world_layers w
  JOIN servers.servers s ON s.id = w.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND w.layer = $2`;

/** The latest stored reading for one server's layer, or undefined when there is none yet (an
 *  unregistered/removed server matches no row, same as a layer that has never been ingested). */
export async function getLatestWorldLayer(db: Queryable, serverPublicId: string, layer: string): Promise<WorldLayerRow | undefined> {
  const result = await db.query(SELECT_LATEST, [serverPublicId, layer]);
  const row = parseFirst(WorldLayerRowSchema, result.rows, "map.world_layers");
  return row === undefined ? undefined : { hash: row.hash, observedAt: toIso(row.observed_at), truncated: row.truncated, count: row.count, data: row.data };
}

const UPSERT_IF_CHANGED = `
  INSERT INTO map.world_layers (server_id, layer, hash, observed_at, truncated, count, data, updated_at)
  SELECT s.id, $2, $3, $4::timestamptz, $5, $6, $7::jsonb, now()
  FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  ON CONFLICT (server_id, layer) DO UPDATE SET
    hash = EXCLUDED.hash, observed_at = EXCLUDED.observed_at, truncated = EXCLUDED.truncated,
    count = EXCLUDED.count, data = EXCLUDED.data, updated_at = now()
  WHERE map.world_layers.hash IS DISTINCT FROM EXCLUDED.hash
  RETURNING server_id`;

/**
 * Writes the layer's latest reading, UNLESS the hash matches what is already stored (ADR-0038 M3's
 * "an unchanged hash writes nothing") — the `WHERE ... IS DISTINCT FROM` guard on the conflict's
 * UPDATE makes that a no-op write, not a read-then-maybe-write race. Returns whether a row was
 * actually written (false for both "unchanged" and "the server doesn't exist/was removed").
 */
export async function upsertWorldLayerIfChanged(db: Queryable, serverPublicId: string, layer: string, next: WorldLayerRow): Promise<{ written: boolean }> {
  const result = await db.query(UPSERT_IF_CHANGED, [serverPublicId, layer, next.hash, next.observedAt, next.truncated, next.count, JSON.stringify(next.data)]);
  return { written: result.rows.length > 0 };
}
