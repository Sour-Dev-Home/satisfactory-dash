import { Router } from "express";
import { StatusResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { ServerDirectory } from "../services/serverDirectory.js";
import { resolveServer, routePath, snapshot } from "./serverScope.js";
import { sendValidated } from "./sendValidated.js";

export function createStatusRouter(directory: ServerDirectory): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (routes/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get(routePath(endpoints.status.route), async (req, res) => {
    const { serverId, services } = resolveServer(directory, req);
    const data = await services.status.getStatus();
    sendValidated(res, StatusResponseSchema, snapshot(serverId, data));
  });
  return router;
}
