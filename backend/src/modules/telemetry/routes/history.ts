import { Router } from "express";
import type { z } from "zod";
import {
  HistoryItemsQuerySchema,
  HistoryItemsResponseSchema,
  HistoryPowerQuerySchema,
  HistoryPowerResponseSchema,
  HistoryTransitionsQuerySchema,
  HistoryTransitionsResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { BadRequestError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { snapshot } from "../../../platform/snapshot.js";
import type { TelemetryScope } from "../telemetryServices.js";

/** A query string that fails its schema is a 400 naming the parameters, never their values. */
function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.output<S> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "query")))].slice(0, 5);
    throw new BadRequestError(`Invalid query parameter: ${names.join(", ")}`);
  }
  return parsed.data;
}

/**
 * ADR-0027 decision 3: stored history, read from the rollups (never from the game server). Members of the server
 * only (the router guard in front of every /api/servers/:serverId route). Without a database there is no history:
 * a 503, the same answer as any other outage of a dependency.
 */
export function createHistoryRouter(directory: ServerDirectory<TelemetryScope>): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware.
  router.get(routePath(endpoints.history.power.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const query = parseQuery(HistoryPowerQuerySchema, req.query);
    if (!services.telemetry.history) throw new ServiceUnavailableError();
    const data = await services.telemetry.history.power(query.range);
    sendValidated(res, HistoryPowerResponseSchema, snapshot(serverId, data));
  });
  router.get(routePath(endpoints.history.items.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const query = parseQuery(HistoryItemsQuerySchema, req.query);
    if (!services.telemetry.history) throw new ServiceUnavailableError();
    const data = await services.telemetry.history.items(query.range, query.item);
    sendValidated(res, HistoryItemsResponseSchema, snapshot(serverId, data));
  });
  router.get(routePath(endpoints.history.transitions.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const query = parseQuery(HistoryTransitionsQuerySchema, req.query);
    if (!services.telemetry.history) throw new ServiceUnavailableError();
    const data = await services.telemetry.history.transitions(query.range, query.limit);
    sendValidated(res, HistoryTransitionsResponseSchema, snapshot(serverId, data));
  });
  return router;
}
