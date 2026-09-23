import { Router } from "express";
import type { PowerService } from "../services/powerService.js";

export function createPowerRouter(service: PowerService): Router {
  const router = Router();
  // No try/catch: Express 5 forwards a rejected handler to the error middleware
  // (routes/errorResponse.ts), which builds the ADR-0003 error envelope.
  router.get("/power", async (_req, res) => {
    res.json(await service.getPowerOverview());
  });
  return router;
}
