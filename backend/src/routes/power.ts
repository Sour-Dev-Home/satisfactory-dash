import { Router } from "express";
import { PowerResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../services/serverDirectory.js";
import { resolveServer, routePath, snapshot } from "./serverScope.js";
import { sendValidated } from "./sendValidated.js";

export function createPowerRouter(directory: ServerDirectory): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (routes/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get(routePath(endpoints.power.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const data = await services.power.getPowerOverview();
    sendValidated(res, PowerResponseSchema, snapshot(serverId, data));
  });
  return router;
}
