import { Router } from "express";
import { ProductionGraphResponseSchema, endpoints } from "@satisfactory-dash/shared";
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
 * ADR-0050 (production planner), build task 4: the production graph, computed on demand from the server's latest factory
 * snapshot and its stored conveyors layer, exactly like the bottlenecks route (same inputs, same member guard, same 503
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
    const started = performance.now();
    const { graph, stats } = buildProductionGraphWithStats(factory.buildings, edges);
    const durationMs = Math.round(performance.now() - started);
    req.log.info({ ...stats, durationMs }, "production graph built");
    sendValidated(res, ProductionGraphResponseSchema, { ...snapshot(serverId, factory), data: graph });
  });
  return router;
}
