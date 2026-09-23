import { Router } from "express";
import { StatusResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../../servers/index.js";
import { resolveServer } from "../../servers/index.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { snapshot } from "../../../platform/snapshot.js";
import type { TelemetryScope } from "../telemetryServices.js";

export function createStatusRouter(directory: ServerDirectory<TelemetryScope>): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (platform/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get(routePath(endpoints.status.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const data = await services.telemetry.status.getStatus();
    sendValidated(res, StatusResponseSchema, snapshot(serverId, data));
  });
  return router;
}
