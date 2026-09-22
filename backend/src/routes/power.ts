import { Router } from "express";
import type { PowerService } from "../services/powerService.js";

export function createPowerRouter(service: PowerService): Router {
  const router = Router();
  router.get("/power", async (_req, res) => {
    try {
      res.json(await service.getPowerOverview());
    } catch (err) {
      res.status(503).json({ error: "Could not reach the Satisfactory dedicated server", detail: String(err) });
    }
  });
  return router;
}
