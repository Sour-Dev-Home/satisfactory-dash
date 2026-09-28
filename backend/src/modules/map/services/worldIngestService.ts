import type { Logger } from "pino";
import { MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_MAX_ITEMS } from "@satisfactory-dash/shared";
import type { MapWorldLayer } from "@satisfactory-dash/shared";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { upsertWorldLayerIfChanged } from "../repositories/worldLayerRepository.js";
import { contentHash } from "./hash.js";

export interface WorldIngestBody {
  observedAt: string;
  data: unknown[];
}

export interface WorldIngestResult {
  accepted: true;
  unchanged: boolean;
}

/** What the agent's POST route and the local poller both need — narrow, so a test can fake it
 *  without building a real `WorldIngestService` (db, logger). */
export interface WorldIngestPort {
  ingest(serverPublicId: string, layer: MapWorldLayer, body: WorldIngestBody): Promise<WorldIngestResult>;
}

/**
 * ADR-0038 M3 (#353): the ingest logic shared by the agent's POST /agent/v1/world/:layer route and
 * the local-server poller — same rules regardless of where the reading came from.
 *
 * "Conform, don't reject" (docs-vault/wiki/runbooks/agent-app.md): an over-cap item COUNT is
 * truncated to `MAP_WORLD_MAX_ITEMS` (`truncated: true`), never rejected outright; then EACH
 * surviving item is re-validated against its layer's per-item schema
 * (`MAP_WORLD_LAYER_ITEM_SCHEMAS`) — defense in depth against a local poller or a stale agent
 * sending something the game-adapter mappers didn't already filter — and one that still fails is
 * dropped and counted, logged at warn with the layer and server id as labels. The 2 MB byte cap
 * (`MAP_WORLD_LAYER_MAX_BYTES`) is enforced by the route's body-size limit, not here (map.ts).
 */
export class WorldIngestService implements WorldIngestPort {
  constructor(
    private readonly db: Queryable,
    private readonly logger: Logger,
  ) {}

  async ingest(serverPublicId: string, layer: MapWorldLayer, body: WorldIngestBody): Promise<WorldIngestResult> {
    const truncated = body.data.length > MAP_WORLD_MAX_ITEMS;
    const capped = truncated ? body.data.slice(0, MAP_WORLD_MAX_ITEMS) : body.data;
    const itemSchema = MAP_WORLD_LAYER_ITEM_SCHEMAS[layer];
    const valid: unknown[] = [];
    let dropped = 0;
    for (const item of capped) {
      const parsed = itemSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      this.logger.warn({ layer, serverId: serverPublicId, dropped }, "map world-layer ingest: dropped items that failed re-validation (defense in depth)");
    }
    const { written } = await upsertWorldLayerIfChanged(this.db, serverPublicId, layer, {
      hash: contentHash(valid),
      observedAt: body.observedAt,
      truncated,
      count: valid.length,
      data: valid,
    });
    return { accepted: true, unchanged: !written };
  }
}
