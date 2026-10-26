import { Router } from "express";
import type { Logger } from "pino";
import { BottlenecksQuerySchema, BottlenecksResponseSchema, ConveyorsLayerDataSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { getLatestWorldLayer, skipReasonOf } from "../../map/index.js";
import type { DesignationStore } from "../../map/index.js";
import { BadRequestError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { snapshot } from "../../../platform/snapshot.js";
import { findBottlenecks } from "../services/bottleneckFinder.js";
import type { BottleneckEdges } from "../services/bottleneckFinder.js";
import type { TelemetryScope } from "../telemetryServices.js";

export interface BottlenecksRouteDeps {
  /** The database the `conveyors` world layer is stored in (map.world_layers). */
  db: Queryable;
  /** ADR-0055 Decision 5: the Planner's designations, read by the production graph route only. Absent = automatic factories only. */
  designations?: Pick<DesignationStore, "list">;
}

/**
 * The conveyors layer as the finder gets it. No row (the agent has not sent one yet, or it predates the conveyors layer) is
 * `notReceived`, which says nothing about FRM. Only a stored skip for the FRM version gate (`unsupportedFrm`) is `unsupported`
 * (an FRM without connection fields); a skip for `tooManyEdges` is `tooLarge`. A row the ingest truncated to its item cap is a
 * partial graph, which would mislead more than item level does, so it is `tooLarge`. A row that fails its schema is logged
 * and treated as `notReceived`: it is not proof of an old FRM.
 */
export async function readEdges(db: Queryable, serverId: string, log?: Pick<Logger, "warn">): Promise<BottleneckEdges> {
  const row = await getLatestWorldLayer(db, serverId, "conveyors");
  if (row === undefined) return "notReceived";
  // #577: a stored skip says why there is no graph (too large vs an FRM without connection fields).
  const skip = skipReasonOf(row);
  if (skip !== undefined) return skip === "unsupportedFrm" ? "unsupported" : "tooLarge";
  if (row.hash.startsWith("skipped:")) {
    // A skip reason this backend doesn't know (version skew): its empty data is not a real, empty graph.
    log?.warn({ serverId }, "stored conveyors layer has an unknown skip reason; treating it as not received");
    return "notReceived";
  }
  if (row.truncated) return "tooLarge";
  const parsed = ConveyorsLayerDataSchema.safeParse(row.data);
  if (!parsed.success) {
    log?.warn({ serverId, issues: parsed.error.issues.slice(0, 3).map((i) => i.message) }, "stored conveyors layer failed its schema; treating it as not received");
    return "notReceived";
  }
  return parsed.data;
}

/**
 * ADR-0048 amendment (#349), PR 4: the bottleneck finder, computed on demand from the server's latest factory snapshot
 * and its stored conveyors layer. Members of the server only (the router guard in front of every /api/servers/:serverId
 * route). Like history, it needs the database (the layer lives there): without one, a 503.
 */
export function createBottlenecksRouter(directory: ServerDirectory<TelemetryScope>, deps?: BottlenecksRouteDeps): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware.
  router.get(routePath(endpoints.bottlenecks.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const query = BottlenecksQuerySchema.safeParse(req.query);
    if (!query.success) {
      const names = [...new Set(query.error.issues.map((issue) => String(issue.path[0] ?? "query")))].slice(0, 5);
      throw new BadRequestError(`Invalid query parameter: ${names.join(", ")}`);
    }
    if (!deps) throw new ServiceUnavailableError();
    const factory = await services.telemetry.production.getFactoryOverview();
    const edges = await readEdges(deps.db, serverId, req.log);
    const data = findBottlenecks(factory.buildings, edges, { limit: query.data.limit });
    // The factory snapshot's own time and staleness (an agent server), not "now".
    sendValidated(res, BottlenecksResponseSchema, { ...snapshot(serverId, factory), data });
  });
  return router;
}
