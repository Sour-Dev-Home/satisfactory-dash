import { Router } from "express";
import type { ServerStatusService } from "../services/serverStatusService.js";

export function createStatusRouter(service: ServerStatusService): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (routes/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get("/status", async (_req, res) => {
    res.json(await service.getStatus());
  });
  return router;
}
