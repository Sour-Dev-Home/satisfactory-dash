import { Router } from "express";
import type { Logger } from "pino";
import { ProductionGraphResponseSchema, ResourceNodesLayerDataSchema, endpoints, type ResourceNode } from "@satisfactory-dash/shared";
import { getLatestWorldLayer } from "../../map/index.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { snapshot } from "../../../platform/snapshot.js";
import { buildProductionGraphWithStats } from "../services/productionGraph.js";
import type { TelemetryScope } from "../telemetryServices.js";
import type { BottlenecksRouteDeps } from "./bottlenecks.js";
import { readEdges } from "./bottlenecks.js";

/**
 * ADR-0055 PR 4: the stored resource-nodes layer, for extractors' items. Any doubt is an empty list, which only means no
 * extractor gets its item from a node: no row, a skip, a schema failure, or a row the ingest truncated (a missing node
 * nearby could make an ambiguous extractor look certain, so a partial layer is never used).
 */
export async function readResourceNodes(db: Queryable, serverId: string, log?: Pick<Logger, "warn">): Promise<ResourceNode[]> {
  const row = await getLatestWorldLayer(db, serverId, "resourceNodes");
  if (row === undefined || row.truncated || row.hash.startsWith("skipped:")) return [];
  const parsed = ResourceNodesLayerDataSchema.safeParse(row.data);
  if (!parsed.success) {
    log?.warn({ serverId, issues: parsed.error.issues.slice(0, 3).map((i) => i.message) }, "stored resourceNodes layer failed its schema; extractors get no item from nodes");
    return [];
  }
  return parsed.data;
}

/**
 * ADR-0050 (production planner), build task 4: the production graph, computed on demand from the server's latest factory
 * snapshot and its stored conveyors layer (plus the resource-nodes layer, ADR-0055 PR 4), exactly like the bottlenecks route (same inputs, same member guard, same 503
 * without a database, no cache: Decision 5). Each request logs one compact line of counts and timing, with no game-server
 * text, so the site merge distance can be tuned from a real save (Decision 8).
 */
export function createProductionGraphRouter(directory: ServerDirectory<TelemetryScope>, deps?: BottlenecksRouteDeps): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware.
  router.get(routePath(endpoints.productionGraph.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    if (!deps) throw new ServiceUnavailableError();
    const factory = await services.telemetry.production.getFactoryOverview();
    const edges = await readEdges(deps.db, serverId, req.log);
    const resourceNodes = await readResourceNodes(deps.db, serverId, req.log);
    const started = performance.now();
    const { graph, stats } = buildProductionGraphWithStats(factory.buildings, edges, resourceNodes);
    const durationMs = Math.round(performance.now() - started);
    req.log.info({ ...stats, durationMs }, "production graph built");
    sendValidated(res, ProductionGraphResponseSchema, { ...snapshot(serverId, factory), data: graph });
  });
  return router;
}
