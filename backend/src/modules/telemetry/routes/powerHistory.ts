import { Router } from "express";
import { PowerHistoryResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import type { TelemetryScope } from "../telemetryServices.js";

/** ADR-0022: served from the poller's in-memory store, never from the game server. */
export function createPowerHistoryRouter(directory: ServerDirectory<TelemetryScope>): Router {
  const router = Router();
  router.get(routePath(endpoints.powerHistory.route), (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const { data, observedAt, stale } = services.telemetry.powerHistory.getPowerHistory();
    sendValidated(res, PowerHistoryResponseSchema, { serverId, observedAt, stale, data });
  });
  return router;
}
