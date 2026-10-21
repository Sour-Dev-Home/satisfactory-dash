import type { Logger } from "pino";
import { MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS, MAP_WORLD_MAX_ITEMS, ownValue } from "@satisfactory-dash/shared";
import type { ConveyorsSkipReason, MapWorldLayer } from "@satisfactory-dash/shared";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { skippedHash, upsertWorldLayerIfChanged } from "../repositories/worldLayerRepository.js";
import { contentHash } from "./hash.js";

/** A reading (`data`), or, for the conveyors layer only, why this cycle has none (`skipped`, #577). */
export type WorldIngestBody = { observedAt: string; data: unknown[] } | { observedAt: string; skipped: ConveyorsSkipReason };

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
    if ("skipped" in body) {
      // #577: no reading this cycle. A row with no edges and the reason in its hash replaces whatever was stored (an older
      // graph is stale anyway); a later good reading has a different hash and replaces this.
      if (layer !== "conveyors") throw new Error(`a skip is only valid for the conveyors layer, not ${String(layer)}`);
      const { written } = await upsertWorldLayerIfChanged(this.db, serverPublicId, layer, {
        hash: skippedHash(body.skipped),
        observedAt: body.observedAt,
        truncated: false,
        count: 0,
        data: [],
      });
      return { accepted: true, unchanged: !written };
    }
    // Each layer's own cap (ADR-0048 amendment: conveyors 50,000, the rest MAP_WORLD_MAX_ITEMS).
    const maxItems = ownValue(MAP_WORLD_LAYER_MAX_ITEMS, layer) ?? MAP_WORLD_MAX_ITEMS;
    const truncated = body.data.length > maxItems;
    const capped = truncated ? body.data.slice(0, maxItems) : body.data;
    // safe-lookup (#368): `layer` is already a validated MapWorldLayer, so an own-value miss here is
    // a bug (the table not covering every layer), never bad input — same convention as
    // historyQueryService.ts's rangeSeconds.
    const itemSchema = ownValue(MAP_WORLD_LAYER_ITEM_SCHEMAS, layer);
    if (itemSchema === undefined) {
      throw new Error(`unknown map world layer: ${String(layer)}`);
    }
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
