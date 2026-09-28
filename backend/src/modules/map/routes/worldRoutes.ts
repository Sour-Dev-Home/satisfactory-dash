import { Router } from "express";
import {
  KNOWN_MAP_WORLD_LAYERS,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MapLiveResponseSchema,
  endpoints,
  worldLayerResponseSchema,
} from "@satisfactory-dash/shared";
import type { MapWorldLayer, MapWorldLayerResponse } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { ApiFailure, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { getLatestWorldLayer } from "../repositories/worldLayerRepository.js";
import { contentHash } from "../services/hash.js";
import type { MapLiveStore } from "../services/mapLiveStore.js";

const isKnownLayer = (layer: string): layer is MapWorldLayer => (KNOWN_MAP_WORLD_LAYERS as readonly string[]).includes(layer);

export interface WorldRoutesDeps {
  db: Queryable;
  mapLive: MapLiveStore;
  now?: () => number;
}

/**
 * ADR-0038 M3 (#353): the member-facing map reads. Mounted AFTER the servers router in the
 * protected-routers array (its membership check, matching "member of the server only", covers
 * these `/servers/:serverId/...` paths too — see telemetry's history.ts for the same convention);
 * without a database there is no `map.world_layers` table at all, so both routes answer 503.
 */
export function createWorldRoutes(directory: ServerDirectory<unknown>, deps?: WorldRoutesDeps): Router {
  const router = Router();
  const now = deps?.now ?? Date.now;

  router.get(routePath(endpoints.map.worldLayer.route), async (req, res) => {
    const { serverId } = resolveServer(directory, req); // 404 for an unknown/non-member server; its `services` aren't needed here
    const layer = typeof req.params.layer === "string" ? req.params.layer : "";
    if (!isKnownLayer(layer)) {
      throw new ApiFailure("not_found", "Unknown map layer");
    }
    if (!deps) throw new ServiceUnavailableError();
    const stored = await getLatestWorldLayer(deps.db, serverId, layer);
    // No row yet (never ingested): a synthetic, still-valid empty response — a real, deterministic
    // hash of `[]`, so a client that already polled once gets a 304 on every later poll too, until
    // a real reading lands (packages/shared/fixtures/map.ts's railsWorldResponseEmpty shape).
    const body = stored ?? { hash: contentHash([]), observedAt: new Date(now()).toISOString(), truncated: false, count: 0, data: [] };
    const etag = `"${body.hash}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("ETag", etag);
    // MAP_WORLD_LAYER_DATA_SCHEMAS[layer]'s value type is the UNION of every layer's schema (TS can't
    // narrow a keyed lookup from the `isKnownLayer` guard above), but `sendValidated` re-validates
    // the real shape at runtime regardless — same trust boundary as any other zod call here.
    sendValidated(res, worldLayerResponseSchema(MAP_WORLD_LAYER_DATA_SCHEMAS[layer]), { layer, ...body } as MapWorldLayerResponse);
  });

  router.get(routePath(endpoints.map.live.route), (req, res) => {
    const { serverId } = resolveServer(directory, req);
    const reading = deps?.mapLive.latest(serverId);
    const data = reading?.data ?? { trains: [], stations: [] };
    sendValidated(res, MapLiveResponseSchema, { serverId, observedAt: new Date(reading?.observedAtMs ?? now()).toISOString(), stale: false, data });
  });

  return router;
}
